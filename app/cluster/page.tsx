"use client";
import { useState, useRef, useEffect } from "react";
import GroupSummaryCard from "@/components/GroupSummaryCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ClusterPage() {
  const [texts, setTexts] = useState<string[]>(["", "", ""]);
  const [weights, setWeights] = useState({
    semantic: 0.4,
    phonetic: 0.3,
    concept: 0.3,
  });
  const [eps, setEps] = useState(0.25);
  const [clusterResult, setClusterResult] = useState<any>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const performClustering = async () => {
    const nonEmptyTexts = texts.filter((t) => t.trim());
    if (nonEmptyTexts.length < 2) {
      setError("At least 2 texts required for clustering");
      setClusterResult(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texts: nonEmptyTexts,
          eps: eps,
          min_samples: 1,
          weights: weights,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setClusterResult(data);
      setSelectedGroupId(null);
    } catch (e: any) {
      setError(e.message);
      setClusterResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleTextChange = (index: number, value: string) => {
    const newTexts = [...texts];
    newTexts[index] = value;
    setTexts(newTexts);

    // Debounce clustering
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performClustering();
    }, 500);
  };

  const handleWeightsChange = (brain: string, value: number) => {
    const newWeights = { ...weights, [brain]: value };
    setWeights(newWeights);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performClustering();
    }, 500);
  };

  const handleEpsChange = (value: number) => {
    setEps(value);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performClustering();
    }, 500);
  };

  const handleAddText = () => {
    setTexts([...texts, ""]);
  };

  const handleRemoveText = (index: number) => {
    if (texts.length > 2) {
      setTexts(texts.filter((_, i) => i !== index));
    }
  };

  const pageStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: "24px",
    padding: "24px",
    maxWidth: "1200px",
    margin: "0 auto",
  };

  const headerStyle = {
    marginBottom: "24px",
  };

  const titleStyle = {
    fontSize: "28px",
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: "8px",
  };

  const descStyle = {
    fontSize: "14px",
    color: "#6b7280",
  };

  const controlsStyle = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
  };

  const sectionStyle = {
    padding: "16px",
    borderRadius: "8px",
    backgroundColor: "#f9fafb",
    border: "1px solid #e5e7eb",
  };

  const labelStyle = {
    fontSize: "13px",
    fontWeight: "600",
    color: "#374151",
    marginBottom: "8px",
    display: "block",
  };

  const textInputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    fontSize: "13px",
    fontFamily: "monospace",
    boxSizing: "border-box" as const,
    marginBottom: "8px",
  };

  const buttonStyle = {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "none",
    fontSize: "12px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 200ms",
    marginRight: "8px",
  };

  const removeButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  };

  const addButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#dbeafe",
    color: "#1e40af",
  };

  const sliderContainerStyle = {
    marginTop: "8px",
  };

  const sliderStyle = {
    width: "100%",
    height: "6px",
    borderRadius: "3px",
    background: "#e5e7eb",
    outline: "none",
    cursor: "pointer",
  };

  const weightsGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  };

  const weightSliderStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  };

  const statsStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  };

  const statCardStyle = {
    padding: "12px",
    borderRadius: "6px",
    backgroundColor: "#f0fdf4",
    border: "1px solid #bbf7d0",
    textAlign: "center" as const,
  };

  const statValueStyle = {
    fontSize: "24px",
    fontWeight: "700",
    color: "#15803d",
  };

  const statLabelStyle = {
    fontSize: "12px",
    color: "#4b5563",
    marginTop: "4px",
  };

  const groupsGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "16px",
  };

  const selectedGroupStyle = {
    padding: "16px",
    borderRadius: "8px",
    backgroundColor: "#fef3c7",
    border: "2px solid #fcd34d",
    marginTop: "16px",
  };

  const selectedGroupTitleStyle = {
    fontSize: "14px",
    fontWeight: "600",
    marginBottom: "12px",
    color: "#92400e",
  };

  const selectedItemsStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  };

  const itemStyle = {
    padding: "10px",
    borderRadius: "4px",
    backgroundColor: "#ffffff",
    border: "1px solid #fcd34d",
    fontSize: "13px",
    color: "#1f2937",
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>🧬 Cluster & Group Duplicates</h1>
        <p style={descStyle}>
          Enter multiple texts to cluster them by similarity using the three-brain system. Adjust epsilon to control cluster tightness.
        </p>
      </div>

      <div style={controlsStyle}>
        {/* Input Texts */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Input Texts ({texts.length})</label>
          {texts.map((text, idx) => (
            <div key={idx} style={{ marginBottom: "8px" }}>
              <textarea
                value={text}
                onChange={(e) => handleTextChange(idx, e.target.value)}
                placeholder={`Text ${idx + 1}...`}
                style={{
                  ...textInputStyle,
                  minHeight: "60px",
                }}
              />
              <button
                onClick={() => handleRemoveText(idx)}
                style={removeButtonStyle}
                disabled={texts.length <= 2}
              >
                ✕ Remove
              </button>
            </div>
          ))}
          <button onClick={handleAddText} style={addButtonStyle}>
            + Add Text
          </button>
        </div>

        {/* Parameters */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Clustering Parameters</label>

          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Sensitivity (ε = {eps.toFixed(2)})</label>
            <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>
              Lower = tighter clusters, Higher = larger groups
            </p>
            <div style={sliderContainerStyle}>
              <input
                type="range"
                min="0.01"
                max="0.99"
                step="0.01"
                value={eps}
                onChange={(e) => handleEpsChange(parseFloat(e.target.value))}
                style={sliderStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Brain Weights</label>
            <div style={weightsGridStyle}>
              {["semantic", "phonetic", "concept"].map((brain) => (
                <div key={brain} style={weightSliderStyle}>
                  <span style={{ fontSize: "11px", fontWeight: "500", color: "#374151" }}>
                    {brain.charAt(0).toUpperCase() + brain.slice(1)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={weights[brain as keyof typeof weights]}
                    onChange={(e) =>
                      handleWeightsChange(brain, parseFloat(e.target.value))
                    }
                    style={sliderStyle}
                  />
                  <span style={{ fontSize: "11px", color: "#6b7280" }}>
                    {(weights[brain as keyof typeof weights] * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div
          style={{
            padding: "12px",
            borderRadius: "6px",
            backgroundColor: "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fca5a5",
            fontSize: "13px",
          }}
        >
          ❌ {error}
        </div>
      )}

      {clusterResult && (
        <>
          {/* Statistics */}
          <div style={statsStyle}>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{clusterResult.total_texts}</div>
              <div style={statLabelStyle}>Total Texts</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{clusterResult.num_clusters}</div>
              <div style={statLabelStyle}>Clusters Found</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{clusterResult.num_noise_points}</div>
              <div style={statLabelStyle}>Noise Points</div>
            </div>
          </div>

          {/* Groups */}
          {clusterResult.groups.length > 0 ? (
            <>
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginTop: "16px" }}>
                📊 Cluster Groups
              </h2>
              <div style={groupsGridStyle}>
                {clusterResult.groups.map((group: any) => (
                  <GroupSummaryCard
                    key={group.group_id}
                    group={group}
                    isSelected={selectedGroupId === group.group_id}
                    onSelect={(gid) =>
                      setSelectedGroupId(
                        selectedGroupId === gid ? null : gid
                      )
                    }
                  />
                ))}
              </div>

              {/* Selected Group Details */}
              {selectedGroupId !== null && (
                <div style={selectedGroupStyle}>
                  <div style={selectedGroupTitleStyle}>
                    📌 Group #{selectedGroupId} Details
                  </div>
                  <div style={selectedItemsStyle}>
                    {clusterResult.groups
                      .find((g: any) => g.group_id === selectedGroupId)
                      ?.items.map((item: any, idx: number) => (
                        <div key={idx} style={itemStyle}>
                          <strong>[{item.language}]</strong> {item.text}
                          <br />
                          <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                            Distance to centroid: {item.distance_to_centroid.toFixed(3)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                color: "#6b7280",
                fontSize: "14px",
              }}
            >
              No clusters found. Try adjusting sensitivity or adding more texts.
            </div>
          )}
        </>
      )}

      {loading && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "24px",
            fontSize: "14px",
            color: "#6b7280",
          }}
        >
          ⏳ Clustering in progress...
        </div>
      )}
    </div>
  );
}
