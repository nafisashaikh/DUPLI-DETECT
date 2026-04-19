"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { searchSimilar, addRecord, addRecordsBulkServerChunked, listRecords, deleteRecord } from "@/lib/api";
import type { SearchMatch, Record as DDRecord } from "@/lib/types";
import { defaultThresholdPercent, defaultBulkChunkSize } from "@/lib/config";
import Papa from "papaparse";
import styles from "./search.module.css";

function SimilarityBar({ value }: { value: number }) {
  const tone = value >= 70 ? "success" : value >= 50 ? "warn" : "accent";
  const progressToneClass =
    tone === "success" ? styles.simSuccess :
    tone === "warn" ? styles.simWarn :
    styles.simAccent;
  const textToneClass =
    tone === "success" ? styles.simTextSuccess :
    tone === "warn" ? styles.simTextWarn :
    styles.simTextAccent;
  return (
    <div className={styles.simRow}>
      <div className={styles.simTrack}>
        <progress className={`${styles.simProgress} ${progressToneClass}`} max={100} value={value} />
      </div>
      <span className={`${styles.simLabel} ${textToneClass}`}>{value}%</span>
    </div>
  );
}

function LanguageFlag({ lang }: { lang: string }) {
  const MAP: Record<string, string> = {
    en: "🇬🇧", ja: "🇯🇵", zh: "🇨🇳", ar: "🇸🇦", th: "🇹🇭", id: "🇮🇩", ko: "🇰🇷",
    de: "🇩🇪", fr: "🇫🇷", hi: "🇮🇳", unknown: "🌐",
  };
  return <span title={lang}>{MAP[lang] ?? "🌐"}</span>;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [threshold, setThreshold] = useState(defaultThresholdPercent());
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [records, setRecords] = useState<DDRecord[]>([]);
  const [addText, setAddText] = useState("");
  const [addMsg, setAddMsg] = useState<{ type: "success" | "warn" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ type: "success" | "warn" | "error"; text: string } | null>(null);
  const [csvProgress, setCsvProgress] = useState<{ done: number; total: number; added: number; duplicates: number; failed: number } | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const fetchRecords = useCallback(async () => {
    try { setRecords(await listRecords()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Debounced real-time search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setMatches([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchSimilar(query, threshold / 100);
        setMatches(r.matches);
      } catch { setMatches([]); }
      finally { setSearching(false); }
    }, 400);
  }, [query, threshold]);

  const handleAdd = async () => {
    if (!addText.trim()) return;
    setAdding(true);
    setAddMsg(null);
    try {
      const r = await addRecord(addText, threshold / 100);
      if (r.inserted) {
        setAddMsg({ type: "success", text: `✓ Record added (id: ${r.id}, lang: ${r.language})` });
        setAddText("");
        fetchRecords();
      } else {
        setAddMsg({
          type: "warn",
          text: `⚠ ${r.warning} — top match: "${r.top_match?.text}" (${r.top_match?.similarity}%)`,
        });
      }
    } catch (e: unknown) {
      setAddMsg({ type: "error", text: e instanceof Error ? e.message : "Failed to add record" });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteRecord(id);
    fetchRecords();
  };

  interface ExtractedRecord {
    text: string;
    item?: string;
    description?: string;
    amount?: string;
    language?: string;
  }

  const extractCsvTexts = async (file: File): Promise<ExtractedRecord[]> => {
    const parseWithHeader = () =>
      new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: "greedy",
          dynamicTyping: false,
          complete: resolve,
          error: reject,
        });
      });

    const parseWithoutHeader = () =>
      new Promise<Papa.ParseResult<unknown[]>>((resolve, reject) => {
        Papa.parse<unknown[]>(file, {
          header: false,
          skipEmptyLines: "greedy",
          dynamicTyping: false,
          complete: resolve,
          error: reject,
        });
      });

    const parseResult = await parseWithHeader();

    const allErrors = (parseResult as Papa.ParseResult<unknown>).errors ?? [];
    // PapaParse sometimes reports a non-fatal delimiter warning for one-column CSVs.
    const fatalErrors = allErrors.filter((e) => e.type !== "Delimiter");
    if (fatalErrors.length > 0) {
      // Prefer first error to keep UX simple
      throw new Error(fatalErrors[0]?.message ?? "CSV parse error");
    }

    const metaFields = parseResult.meta?.fields ?? [];
    const data = parseResult.data ?? [];
    if (!Array.isArray(data) || data.length === 0) return [];

    const fieldLower = metaFields.map((f) => f.toLowerCase());
    const textFieldIndex = fieldLower.findIndex((f) => f === "name" || f === "text" || f === "record" || f === "message" || f === "title");
    const recognizedHeader = textFieldIndex >= 0;

    // If the “header” looks like actual record text (common in 1-column CSVs with no header), reparse.
    const headerLooksLikeData =
      metaFields.length === 1 &&
      !recognizedHeader &&
      (metaFields[0].length > 30 || /\s|[.!?。！？]/.test(metaFields[0]));

    if (headerLooksLikeData) {
      const noHeader = await parseWithoutHeader();
      const rows = noHeader.data ?? [];
      const texts = rows
        .map((row) => (Array.isArray(row) ? (row[0] ?? "") : "").toString().trim())
        .filter(Boolean);
      const unique: ExtractedRecord[] = [];
      const seen = new Set<string>();
      for (const t of texts) {
        if (seen.has(t)) continue;
        seen.add(t);
        unique.push({ text: t });
      }
      return unique;
    }

    const chosenField = recognizedHeader ? metaFields[textFieldIndex] : metaFields[0];
    const descField = metaFields.find(f => f.toLowerCase() === "description" || f.toLowerCase() === "desc");
    const itemField = metaFields.find(f => f.toLowerCase() === "id" || f.toLowerCase() === "item");
    const amountField = metaFields.find(f => f.toLowerCase() === "amount" || f.toLowerCase() === "price" || f.toLowerCase() === "quantity");
    const langField = metaFields.find(f => f.toLowerCase() === "language" || f.toLowerCase() === "lang");

    const records = data
      .map((row) => {
        const r = row as Record<string, unknown>;
        const v = r[chosenField];
        const textStr = (v ?? "").toString().trim();
        if (!textStr) return null;
        const rec: ExtractedRecord = { text: textStr };
        if (itemField && r[itemField]) rec.item = r[itemField]?.toString().trim();
        if (descField && r[descField]) rec.description = r[descField]?.toString().trim();
        if (amountField && r[amountField]) rec.amount = r[amountField]?.toString().trim();
        if (langField && r[langField]) rec.language = r[langField]?.toString().trim();
        return rec;
      })
      .filter((r): r is ExtractedRecord => r !== null);

    // De-dupe within upload to avoid wasting API calls
    const unique: ExtractedRecord[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      unique.push(r);
    }
    return unique;
  };

  const handleCsvUpload = async (file: File) => {
    setCsvMsg(null);
    setCsvProgress(null);
    setCsvUploading(true);
    try {
      const records = await extractCsvTexts(file);
      if (records.length === 0) {
        setCsvMsg({ type: "warn", text: "No usable rows found. Include a 'text' or 'name' column (recommended) or put the record text in the first column." });
        return;
      }

      setCsvProgress({ done: 0, total: records.length, added: 0, duplicates: 0, failed: 0 });
      const result = await addRecordsBulkServerChunked(records, {
        chunkSize: defaultBulkChunkSize(),
        threshold: threshold / 100,
        onProgress: (p) => setCsvProgress(p),
      });

      const summary = `Added ${result.added}/${result.total}. Duplicates: ${result.duplicates}. Failed: ${result.failed}.`;
      setCsvMsg(result.failed > 0 ? { type: "warn", text: summary } : { type: "success", text: summary });
      fetchRecords();
    } catch (e: unknown) {
      setCsvMsg({ type: "error", text: e instanceof Error ? e.message : "CSV upload failed" });
    } finally {
      setCsvUploading(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const messageClass = (type: "success" | "warn" | "error") =>
    type === "success" ? styles.msgSuccess : type === "warn" ? styles.msgWarn : styles.msgError;

  return (
    <div className={styles.container}>
      <div className={`animate-fade-up ${styles.header}`}>
        <p className={`section-label ${styles.headerLabel}`}>Feature 4</p>
        <h1 className={styles.headerTitle}>Real-Time Search</h1>
        <p className={styles.headerSubtitle}>
          Type anything — the system instantly surfaces similar records above your threshold and warns you before inserting duplicates.
        </p>
      </div>

      <div className={styles.grid}>
        {/* ── Left column ── */}
        <div className={styles.leftCol}>

          {/* Search box */}
          <div className={`card ${styles.cardPad24}`}>
            <label className={styles.searchLabel} htmlFor="search-input">
              Search Query
            </label>
            <div className={styles.relative}>
              <input
                id="search-input"
                className={`input ${styles.searchInput}`}
                placeholder="Start typing… (e.g. Login problem)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching && (
                <span
                  className={`animate-spin ${styles.spinner}`}
                >
                  ⟳
                </span>
              )}
            </div>

            {/* Threshold slider */}
            <div className={styles.sliderWrap}>
              <div className={styles.sliderMeta}>
                <span>Similarity threshold</span>
                <span className={styles.sliderValue}>{threshold}%</span>
              </div>
              <input
                type="range"
                min={10} max={99} step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className={styles.range}
                aria-label="Similarity threshold"
                title="Similarity threshold"
              />
            </div>
          </div>

          {/* Matches */}
          {query.trim() && (
            <div className={`card animate-fade-up ${styles.matchesCard}`}>
              <div className={styles.matchesHeader}>
                <h3 className={styles.matchesTitle}>
                  {matches.length > 0 ? `${matches.length} match${matches.length > 1 ? "es" : ""} found` : "No matches above threshold"}
                </h3>
                {matches.length > 0 && (
                  <span className="badge badge-warn">⚠ Possible duplicates</span>
                )}
              </div>

              {matches.length === 0 && !searching && (
                <div className={styles.noMatches}>
                  🎉 No matches — record appears to be unique
                </div>
              )}

              <div className={styles.matchList}>
                {matches.map((m) => (
                  <div
                    key={m.id}
                    className={styles.matchItem}
                  >
                    <div className={styles.matchTop}>
                      <div className={styles.matchTextRow}>
                        <LanguageFlag lang={m.language} />
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span className={styles.matchText}>{m.text}</span>
                          {(m.item || m.description || m.amount) && (
                            <div style={{ fontSize: "0.85em", color: "var(--fg-muted)", marginTop: "2px" }}>
                              {m.item && <div><strong>Item:</strong> {m.item}</div>}
                              {m.description && <div><strong>Description:</strong> {m.description}</div>}
                              {m.amount && <div><strong>Amount:</strong> {m.amount}</div>}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="badge badge-info">{m.language}</span>
                    </div>
                    <SimilarityBar value={m.similarity} />
                  </div>
                ))}
              </div>

              {/* JSON output */}
              {matches.length > 0 && (
                <details className={styles.details}>
                  <summary className={styles.summary}>API response</summary>
                  <pre
                    className={`mono ${styles.pre}`}
                  >
                    {JSON.stringify({ input: query, matches }, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Add record */}
          <div className={`card ${styles.cardPad24}`}>
            <h3 className={styles.addTitle}>Add New Record</h3>
            <div className={styles.addRow}>
              <input
                id="add-record-input"
                className={`input ${styles.addInput}`}
                placeholder="New record text…"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                aria-label="New record text"
              />
              <button
                id="add-record-btn"
                className={`btn btn-primary ${styles.nowrap}`}
                onClick={handleAdd}
                disabled={adding || !addText.trim()}
              >
                {adding ? "…" : "+ Add"}
              </button>
            </div>
            {addMsg && (
              <div
                className={`${styles.msgBox} ${messageClass(addMsg.type)}`}
              >
                {addMsg.text}
              </div>
            )}

            <div className={`divider ${styles.divider}`} />

            <div className={styles.csvRow}>
              <div>
                <p className={`section-label ${styles.csvLabel}`}>CSV Upload</p>
                <p className={styles.csvHint}>
                  Upload a CSV with a <span className="mono">text</span> column (or use the first column).
                </p>
              </div>
              <div className={styles.csvControls}>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCsvUpload(f);
                  }}
                  className={styles.hiddenFile}
                  aria-label="Upload CSV file"
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={csvUploading}
                >
                  {csvUploading ? "Uploading…" : "⇪ Upload CSV"}
                </button>
              </div>
            </div>

            {csvProgress && (
              <div className={styles.progressBlock}>
                <div className={styles.progressMeta}>
                  <span>Progress</span>
                  <span className={styles.progressValue}>{csvProgress.done}/{csvProgress.total}</span>
                </div>
                <progress
                  className={styles.progress}
                  max={Math.max(csvProgress.total, 1)}
                  value={Math.min(csvProgress.done, Math.max(csvProgress.total, 1))}
                />
                <div className={styles.progressStats}>
                  <span>Added: <span className={styles.statSuccess}>{csvProgress.added}</span></span>
                  <span>Duplicates: <span className={styles.statWarn}>{csvProgress.duplicates}</span></span>
                  <span>Failed: <span className={styles.statDanger}>{csvProgress.failed}</span></span>
                </div>
              </div>
            )}

            {csvMsg && (
              <div
                className={`${styles.msgBox} ${messageClass(csvMsg.type)}`}
              >
                {csvMsg.text}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column — record list ── */}
        <div className={`card ${styles.rightCard}`}>
          <div className={styles.rightHeader}>
            <h3 className={styles.rightTitle}>Dataset ({records.length})</h3>
            <button className={`btn btn-ghost ${styles.refreshBtn}`} onClick={fetchRecords}>
              ↻ Refresh
            </button>
          </div>

          {records.length === 0 ? (
            <div className={styles.emptyRight}>
              No records yet — add one above
            </div>
          ) : (
            <div className={styles.recordList}>
              {records.map((r) => (
                <div
                  key={r.id}
                  className={styles.recordRow}
                >
                  <div className={styles.recordLeft}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className={styles.recordText}>{r.text}</span>
                        <span className={`badge badge-info ${styles.badgeSelf}`}>{r.language}</span>
                      </div>
                      {(r.item || r.description || r.amount) && (
                        <div style={{ fontSize: "0.85em", color: "var(--fg-muted)", marginTop: "2px" }}>
                          {r.item && <div><strong>Item:</strong> {r.item}</div>}
                          {r.description && <div><strong>Description:</strong> {r.description}</div>}
                          {r.amount && <div><strong>Amount:</strong> {r.amount}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className={styles.deleteBtn}
                    title="Delete"
                    aria-label="Delete record"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
