/**
 * DemoDataLoader - Component for loading/clearing demo multilingual dataset
 */
"use client";
import { useState } from "react";
import { loadDemoData, clearAllRecords, getDemoData } from "@/lib/api";

export default function DemoDataLoader({ onLoaded }: { onLoaded?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleLoadDemo = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await loadDemoData();
      setSuccess(
        `✓ Loaded ${result.added} records, ${result.duplicates} duplicates detected, ${result.failed} failed`
      );
      onLoaded?.();
    } catch (e: any) {
      setError(`Failed to load demo data: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear all records? This cannot be undone.")) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await clearAllRecords();
      setSuccess("✓ All records cleared");
      onLoaded?.();
    } catch (e: any) {
      setError(`Failed to clear records: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const containerStyle = {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap" as const,
  };

  const buttonStyle = {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "none",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 200ms",
    disabled: loading,
  };

  const loadButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#dbeafe",
    color: "#1e40af",
  };

  const clearButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  };

  const messageStyle = {
    fontSize: "12px",
    padding: "8px 12px",
    borderRadius: "4px",
    marginLeft: "auto",
  };

  const errorStyle = {
    ...messageStyle,
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fca5a5",
  };

  const successStyle = {
    ...messageStyle,
    backgroundColor: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
  };

  return (
    <div style={containerStyle}>
      <button
        onClick={handleLoadDemo}
        disabled={loading}
        style={loadButtonStyle}
        title="Load 50 sample multilingual texts for testing"
      >
        📊 Load Sample Dataset
      </button>
      <button
        onClick={handleClear}
        disabled={loading}
        style={clearButtonStyle}
        title="Clear all stored records"
      >
        🗑️ Clear All Records
      </button>
      {error && <div style={errorStyle}>{error}</div>}
      {success && <div style={successStyle}>{success}</div>}
    </div>
  );
}
