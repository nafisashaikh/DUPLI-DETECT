"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { searchSimilar, addRecord, addRecordsBulkServerChunked, listRecords, deleteRecord } from "@/lib/api";
import type { SearchMatch, Record as DDRecord } from "@/lib/types";
import { defaultThresholdPercent, defaultBulkChunkSize } from "@/lib/config";
import Papa from "papaparse";

function SimilarityBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "var(--success)" :
    value >= 50 ? "var(--warn)" :
    "var(--accent)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div className="progress-bar" style={{ flex: 1 }}>
        <div
          className="progress-fill"
          style={{
            width: `${value}%`,
            background: color,
            height: "100%",
            borderRadius: 99,
            transition: "width 0.5s cubic-bezier(.34,1.56,.64,1)",
          }}
        />
      </div>
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color, minWidth: 38, textAlign: "right" }}>
        {value}%
      </span>
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

  const extractCsvTexts = async (file: File): Promise<string[]> => {
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
    const textFieldIndex = fieldLower.findIndex((f) => f === "text" || f === "record" || f === "message" || f === "title");
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
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const t of texts) {
        if (seen.has(t)) continue;
        seen.add(t);
        unique.push(t);
      }
      return unique;
    }

    const chosenField = recognizedHeader ? metaFields[textFieldIndex] : metaFields[0];

    const texts = data
      .map((row) => {
        const v = (row as Record<string, unknown>)[chosenField];
        return (v ?? "").toString().trim();
      })
      .filter(Boolean);

    // De-dupe within upload to avoid wasting API calls
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const t of texts) {
      if (seen.has(t)) continue;
      seen.add(t);
      unique.push(t);
    }
    return unique;
  };

  const handleCsvUpload = async (file: File) => {
    setCsvMsg(null);
    setCsvProgress(null);
    setCsvUploading(true);
    try {
      const texts = await extractCsvTexts(file);
      if (texts.length === 0) {
        setCsvMsg({ type: "warn", text: "No usable rows found. Include a 'text' column (recommended) or put the record text in the first column." });
        return;
      }

      setCsvProgress({ done: 0, total: texts.length, added: 0, duplicates: 0, failed: 0 });
      const result = await addRecordsBulkServerChunked(texts, {
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

  const msgColors = { success: "var(--success)", warn: "var(--warn)", error: "var(--danger)" };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px 80px" }}>
      <div className="animate-fade-up" style={{ marginBottom: 36 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>Feature 4</p>
        <h1 style={{ fontSize: "clamp(1.6rem,4vw,2.4rem)", marginBottom: 8 }}>Real-Time Search</h1>
        <p style={{ color: "var(--text-secondary)" }}>
          Type anything — the system instantly surfaces similar records above your threshold and warns you before inserting duplicates.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Search box */}
          <div className="card" style={{ padding: 24 }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>
              Search Query
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="search-input"
                className="input"
                placeholder="Start typing… (e.g. Login problem)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingRight: 44 }}
              />
              {searching && (
                <span
                  className="animate-spin"
                  style={{
                    position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                    fontSize: 16, display: "inline-block", color: "var(--accent)",
                  }}
                >
                  ⟳
                </span>
              )}
            </div>

            {/* Threshold slider */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 6 }}>
                <span>Similarity threshold</span>
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>{threshold}%</span>
              </div>
              <input
                type="range"
                min={10} max={99} step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
            </div>
          </div>

          {/* Matches */}
          {query.trim() && (
            <div className="card animate-fade-up" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: "1rem" }}>
                  {matches.length > 0 ? `${matches.length} match${matches.length > 1 ? "es" : ""} found` : "No matches above threshold"}
                </h3>
                {matches.length > 0 && (
                  <span className="badge badge-warn">⚠ Possible duplicates</span>
                )}
              </div>

              {matches.length === 0 && !searching && (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  🎉 No matches — record appears to be unique
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {matches.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "14px 16px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <LanguageFlag lang={m.language} />
                        <span style={{ fontSize: "0.95rem", color: "var(--text-primary)" }}>{m.text}</span>
                      </div>
                      <span className="badge badge-info">{m.language}</span>
                    </div>
                    <SimilarityBar value={m.similarity} />
                  </div>
                ))}
              </div>

              {/* JSON output */}
              {matches.length > 0 && (
                <details style={{ marginTop: 16, fontSize: "0.8rem" }}>
                  <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>API response</summary>
                  <pre
                    className="mono"
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: 12,
                      overflowX: "auto",
                      color: "var(--accent-3)",
                      fontSize: "0.77rem",
                      marginTop: 8,
                    }}
                  >
                    {JSON.stringify({ input: query, matches }, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Add record */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 14 }}>Add New Record</h3>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                id="add-record-input"
                className="input"
                placeholder="New record text…"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                style={{ flex: 1 }}
              />
              <button
                id="add-record-btn"
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={adding || !addText.trim()}
                style={{ whiteSpace: "nowrap" }}
              >
                {adding ? "…" : "+ Add"}
              </button>
            </div>
            {addMsg && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: `${msgColors[addMsg.type]}18`,
                  border: `1px solid ${msgColors[addMsg.type]}33`,
                  color: msgColors[addMsg.type],
                  fontSize: "0.85rem",
                }}
              >
                {addMsg.text}
              </div>
            )}

            <div className="divider" style={{ margin: "18px 0" }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <p className="section-label" style={{ marginBottom: 4 }}>CSV Upload</p>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  Upload a CSV with a <span className="mono">text</span> column (or use the first column).
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCsvUpload(f);
                  }}
                  style={{ display: "none" }}
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
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 6 }}>
                  <span>Progress</span>
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{csvProgress.done}/{csvProgress.total}</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${csvProgress.total > 0 ? Math.round((csvProgress.done / csvProgress.total) * 100) : 0}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  <span>Added: <span style={{ color: "var(--success)", fontWeight: 700 }}>{csvProgress.added}</span></span>
                  <span>Duplicates: <span style={{ color: "var(--warn)", fontWeight: 700 }}>{csvProgress.duplicates}</span></span>
                  <span>Failed: <span style={{ color: "var(--danger)", fontWeight: 700 }}>{csvProgress.failed}</span></span>
                </div>
              </div>
            )}

            {csvMsg && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: `${msgColors[csvMsg.type]}18`,
                  border: `1px solid ${msgColors[csvMsg.type]}33`,
                  color: msgColors[csvMsg.type],
                  fontSize: "0.85rem",
                }}
              >
                {csvMsg.text}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column — record list ── */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ fontSize: "0.95rem" }}>Dataset ({records.length})</h3>
            <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: "0.75rem" }} onClick={fetchRecords}>
              ↻ Refresh
            </button>
          </div>

          {records.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "16px 0", textAlign: "center" }}>
              No records yet — add one above
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto" }}>
              {records.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "0.875rem" }}>{r.text}</span>
                    <span className="badge badge-info" style={{ alignSelf: "flex-start" }}>{r.language}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      fontSize: "1rem",
                      padding: "2px 4px",
                      flexShrink: 0,
                    }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media(max-width:768px) {
          div[style*="1fr 360px"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
