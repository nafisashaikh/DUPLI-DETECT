"use client";
import { useState } from "react";
import { compareTexts } from "@/lib/api";
import type { CompareResult } from "@/lib/types";

const EXAMPLES = [
  { t1: "Login issue", t2: "ログインの問題", label: "EN → JP" },
  { t1: "Login issue", t2: "登录问题", label: "EN → ZH" },
  { t1: "Login issue", t2: "Login isssue", label: "Typo" },
  { t1: "Login issue", t2: "Cannot log in", label: "Semantic" },
  { t1: "Payment failed", t2: "الدفع فشل", label: "EN → AR" },
];

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  typo:                { label: "Typo",              color: "var(--warn)",    icon: "✏️" },
  language_difference: { label: "Language Diff",     color: "var(--accent-3)", icon: "🌐" },
  semantic:            { label: "Semantic Match",     color: "var(--accent-2)", icon: "💡" },
  not_duplicate:       { label: "Not a Duplicate",   color: "var(--text-muted)", icon: "✗" },
};

function SimilarityGauge({ value }: { value: number }) {
  const color =
    value >= 70 ? "var(--success)" :
    value >= 40 ? "var(--warn)" :
    "var(--danger)";
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={130} height={130} viewBox="0 0 130 130">
        <circle cx={65} cy={65} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
        <circle
          cx={65} cy={65} r={r} fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 65 65)"
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(.34,1.56,.64,1), stroke 0.4s" }}
        />
        <text x={65} y={60} textAnchor="middle" fill={color} fontSize={26} fontWeight={800} fontFamily="Inter">
          {value}
        </text>
        <text x={65} y={78} textAnchor="middle" fill="var(--text-muted)" fontSize={11} fontFamily="Inter">
          similarity
        </text>
      </svg>
    </div>
  );
}

function LangBadge({ lang }: { lang: string }) {
  return (
    <span className="badge badge-info" style={{ fontSize: "0.7rem" }}>
      {lang}
    </span>
  );
}

export default function ComparePage() {
  const [text1, setText1] = useState("");
  const [text2, setText2] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCompare = async () => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const r = await compareTexts(text1, text2);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  const loadExample = (ex: { t1: string; t2: string }) => {
    setText1(ex.t1);
    setText2(ex.t2);
    setResult(null);
  };

  const typeMeta = result ? (TYPE_META[result.duplicate_type] ?? TYPE_META.not_duplicate) : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px" }}>
      <div className="animate-fade-up">
        <p className="section-label" style={{ marginBottom: 8 }}>Feature 1 + 2 + 3</p>
        <h1 style={{ fontSize: "clamp(1.6rem,4vw,2.4rem)", marginBottom: 8 }}>
          Compare Records
        </h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: 32 }}>
          Paste two texts in any language and get similarity score + duplicate type classification.
        </p>
      </div>

      {/* Example chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", alignSelf: "center" }}>Examples:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            className="btn btn-ghost"
            style={{ padding: "5px 14px", fontSize: "0.775rem" }}
            onClick={() => loadExample(ex)}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div
        className="card"
        style={{
          padding: 28,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Record A</label>
          <textarea
            id="text1-input"
            className="input"
            rows={5}
            placeholder="e.g. Login issue…"
            value={text1}
            onChange={(e) => setText1(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Record B</label>
          <textarea
            id="text2-input"
            className="input"
            rows={5}
            placeholder="e.g. ログインの問題…"
            value={text2}
            onChange={(e) => setText2(e.target.value)}
          />
        </div>

        <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "center" }}>
          <button
            id="compare-btn"
            className="btn btn-primary"
            style={{ minWidth: 200 }}
            onClick={handleCompare}
            disabled={loading || !text1.trim() || !text2.trim()}
          >
            {loading ? (
              <>
                <span className="animate-spin" style={{ display: "inline-block" }}>⟳</span>
                Analysing…
              </>
            ) : (
              "⚡ Compare"
            )}
          </button>
        </div>

        {error && (
          <div style={{ gridColumn: "1/-1", color: "var(--danger)", fontSize: "0.875rem", textAlign: "center" }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="card animate-fade-up" style={{ padding: 36 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 40,
              alignItems: "center",
            }}
          >
            {/* Gauge */}
            <SimilarityGauge value={result.similarity_score} />

            {/* Details */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Duplicate verdict */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 800,
                    color: result.is_duplicate ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {result.is_duplicate ? "✓ Duplicates" : "✗ Different"}
                </span>
                {typeMeta && (
                  <span
                    className="badge"
                    style={{
                      background: `${typeMeta.color}22`,
                      color: typeMeta.color,
                      border: `1px solid ${typeMeta.color}44`,
                    }}
                  >
                    {typeMeta.icon} {typeMeta.label}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 6 }}>
                  <span>Similarity Score</span>
                  <span>{result.similarity_score}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${result.similarity_score}%`,
                      background:
                        result.similarity_score >= 70
                          ? "linear-gradient(90deg,var(--success),#34d399)"
                          : result.similarity_score >= 40
                          ? "linear-gradient(90deg,var(--warn),#fbbf24)"
                          : "linear-gradient(90deg,var(--danger),#fb7185)",
                    }}
                  />
                </div>
              </div>

              {/* Languages */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Languages:</span>
                <LangBadge lang={result.lang1} />
                <span style={{ color: "var(--text-muted)" }}>→</span>
                <LangBadge lang={result.lang2} />
              </div>

              {/* JSON preview */}
              <details style={{ fontSize: "0.8rem" }}>
                <summary style={{ cursor: "pointer", color: "var(--text-muted)", marginBottom: 8 }}>
                  Raw JSON response
                </summary>
                <pre
                  className="mono"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 14,
                    overflowX: "auto",
                    color: "var(--accent-3)",
                    fontSize: "0.78rem",
                  }}
                >
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 600px) {
          .card > div { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
