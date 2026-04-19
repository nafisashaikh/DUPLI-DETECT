/**
 * GroupSummaryCard - Display cluster/group information for duplicate text groups
 * Shows: group size, languages, dominant match reason, average confidence
 */

export default function GroupSummaryCard({
  group,
  onSelect,
  isSelected = false,
}) {
  if (!group) return null;

  const {
    group_id,
    size,
    confidence,
    languages,
    items,
    dominant_match_reason,
  } = group;

  const containerStyle = {
    padding: "16px",
    border: isSelected ? "2px solid #3b82f6" : "1px solid #e5e7eb",
    borderRadius: "8px",
    backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
    cursor: "pointer",
    transition: "all 200ms ease",
    boxShadow: isSelected ? "0 4px 6px rgba(59, 130, 246, 0.15)" : "none",
  };

  const headerStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: "8px",
  };

  const titleStyle = {
    fontSize: "16px",
    fontWeight: "600",
    color: "#1f2937",
  };

  const badgeStyle = {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: "12px",
    backgroundColor: "#dbeafe",
    color: "#1e40af",
    fontSize: "12px",
    fontWeight: "500",
  };

  const metricStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
    fontSize: "14px",
    color: "#6b7280",
  };

  const labelStyle = {
    fontWeight: "500",
  };

  const valueStyle = {
    color: "#111827",
    fontWeight: "600",
  };

  // Confidence color coding
  const getConfidenceColor = (conf) => {
    if (conf >= 0.9) return "#10b981"; // Green
    if (conf >= 0.75) return "#f59e0b"; // Amber
    return "#ef4444"; // Red
  };

  const confidenceBarStyle = {
    marginTop: "8px",
    marginBottom: "12px",
  };

  const barBackgroundStyle = {
    width: "100%",
    height: "6px",
    backgroundColor: "#e5e7eb",
    borderRadius: "3px",
    overflow: "hidden",
  };

  const barFillStyle = {
    height: "100%",
    width: `${Math.min(100, Math.max(0, confidence * 100))}%`,
    backgroundColor: getConfidenceColor(confidence),
    transition: "width 300ms ease",
  };

  const reasonStyle = {
    padding: "8px 12px",
    backgroundColor: "#f3f4f6",
    borderRadius: "6px",
    fontSize: "13px",
    color: "#374151",
    marginTop: "8px",
    fontStyle: "italic",
  };

  const tagsStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  };

  const tagStyle = {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: "4px",
    backgroundColor: "#e0e7ff",
    color: "#4f46e5",
    fontSize: "11px",
    fontWeight: "500",
  };

  return (
    <div style={containerStyle} onClick={() => onSelect?.(group_id)}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          Group #{group_id} ({size} text{size !== 1 ? "s" : ""})
        </div>
        <div style={badgeStyle}>{(confidence * 100).toFixed(0)}% Match</div>
      </div>

      <div style={metricStyle}>
        <span style={labelStyle}>Size:</span>
        <span style={valueStyle}>{size} items</span>
      </div>

      <div style={metricStyle}>
        <span style={labelStyle}>Languages:</span>
        <span style={valueStyle}>{languages.join(", ") || "Unknown"}</span>
      </div>

      <div>
        <div style={labelStyle} className="text-gray-700">
          Confidence
        </div>
        <div style={confidenceBarStyle}>
          <div style={barBackgroundStyle}>
            <div style={barFillStyle} />
          </div>
        </div>
      </div>

      <div style={reasonStyle}>
        <strong>Match Reason:</strong> {dominant_match_reason}
      </div>

      <div style={tagsStyle}>
        {items.slice(0, 3).map((item, idx) => (
          <div key={idx} style={tagStyle} title={item.text}>
            {item.text.substring(0, 20)}
            {item.text.length > 20 ? "…" : ""}
          </div>
        ))}
        {items.length > 3 && (
          <div style={tagStyle}>+{items.length - 3} more</div>
        )}
      </div>
    </div>
  );
}
