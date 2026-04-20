"use client";

export default function BrainScores({
  semanticScore,
  phoneticScore,
  conceptScore,
  finalScore,
  isDuplicate,
  explanation,
  weights,
  onWeightsChange,
  threshold = 0.75,
  onThresholdChange,
}) {
  const brains = [
    {
      key: "semantic",
      label: "Brain 1 – Meaning",
      score: semanticScore,
    },
    {
      key: "phonetic",
      label: "Brain 2 – Sound",
      score: phoneticScore,
    },
    {
      key: "concept",
      label: "Brain 3 – Knowledge",
      score: conceptScore,
    },
  ];

  const scoreLabel = (score) => {
    if (score >= 0.75) return "#10b981";
    if (score >= 0.5) return "#f59e0b";
    return "#ef4444";
  };

  const formatPercent = (value) => `${Math.round(value * 100)}%`;

  const normalizeWeights = (newWeights) => {
    const positive = Object.entries(newWeights).filter(([, value]) => value > 0);
    if (positive.length === 0) {
      return { semantic: 1 / 3, phonetic: 1 / 3, concept: 1 / 3 };
    }
    const total = positive.reduce((sum, [, value]) => sum + value, 0);
    return {
      semantic: newWeights.semantic > 0 ? newWeights.semantic / total : 0,
      phonetic: newWeights.phonetic > 0 ? newWeights.phonetic / total : 0,
      concept: newWeights.concept > 0 ? newWeights.concept / total : 0,
    };
  };

  const handleToggle = (key) => {
    const nextWeights = { ...weights };
    const isActive = nextWeights[key] > 0;

    if (isActive) {
      nextWeights[key] = 0;
    } else {
      const otherKeys = Object.keys(nextWeights).filter((k) => k !== key);
      const otherSum = otherKeys.reduce((sum, k) => sum + nextWeights[k], 0);
      if (otherSum > 0) {
        const target = 1 / 3;
        nextWeights[key] = target;
        const scale = (1 - target) / otherSum;
        otherKeys.forEach((k) => {
          nextWeights[k] = nextWeights[k] * scale;
        });
      } else {
        nextWeights.semantic = 1 / 3;
        nextWeights.phonetic = 1 / 3;
        nextWeights.concept = 1 / 3;
      }
    }

    onWeightsChange(normalizeWeights(nextWeights));
  };

  const handleThreshold = (event) => {
    const value = parseFloat(event.target.value);
    onThresholdChange(value);
  };

  const duplicate = typeof isDuplicate === "boolean" ? isDuplicate : finalScore >= threshold;

  return (
    <div style={{ display: "grid", gap: 20, padding: 24, background: "#111827", borderRadius: 24, color: "#f8fafc" }}>
      <div style={{ display: "grid", gap: 18 }}>
        {brains.map((brain) => (
          <div key={brain.key} style={{ display: "grid", gap: 10, padding: 16, background: "rgba(255,255,255,0.04)", borderRadius: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "0.95rem", color: "#9ca3af", marginBottom: 6 }}>{brain.label}</div>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>{formatPercent(brain.score)}</div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(brain.key)}
                style={{
                  border: "1px solid rgba(255,255,255,0.16)",
                  borderRadius: 999,
                  background: brain.score > 0 || weights[brain.key] > 0 ? "#10b981" : "rgba(255,255,255,0.08)",
                  color: brain.score > 0 || weights[brain.key] > 0 ? "#ffffff" : "#9ca3af",
                  padding: "8px 14px",
                  cursor: "pointer",
                  minWidth: 110,
                }}
              >
                {weights[brain.key] > 0 ? "Enabled" : "Disabled"}
              </button>
            </div>
            <div style={{ width: "100%", background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 12, overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, brain.score * 100))}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: scoreLabel(brain.score),
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 16, padding: 18, background: "rgba(255,255,255,0.04)", borderRadius: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ color: "#9ca3af", fontSize: "0.9rem", marginBottom: 6 }}>Duplicate threshold</div>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>{threshold.toFixed(2)}</div>
          </div>
          <input
            type="range"
            min={0.5}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={handleThreshold}
            style={{ width: "100%", marginLeft: 12, accentColor: "#10b981" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, padding: 20, background: "rgba(255,255,255,0.06)", borderRadius: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
          <div>
            <div style={{ fontSize: "0.9rem", color: "#9ca3af" }}>Final score</div>
            <div style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1 }}>{formatPercent(finalScore)}</div>
          </div>
          <div
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              background: duplicate ? "#064e3b" : "#7f1d1d",
              color: "#f8fafc",
              fontWeight: 700,
              fontSize: "0.9rem",
            }}
          >
            {duplicate ? "DUPLICATE" : "NOT DUPLICATE"}
          </div>
        </div>
        <div style={{ padding: 16, background: "rgba(15,23,42,0.95)", borderRadius: 18, color: "#e5e7eb" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 10 }}>Explanation</div>
          <div style={{ lineHeight: 1.7, color: "#d1d5db" }}>{explanation}</div>
        </div>
      </div>
    </div>
  );
}
