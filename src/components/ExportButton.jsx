"use client";

import { useState } from "react";
import { exportDashboardPDF } from "@/src/utils/exportPDF";

const UI_TEXT = {
  label: "Export PDF",
  loading: "Exporting...",
  success: "PDF exported successfully.",
  error: "Failed to export PDF.",
};

export default function ExportButton({ data, className = "" }) {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      await exportDashboardPDF(data);
      showToast(UI_TEXT.success, "success");
    } catch (error) {
      showToast(`${UI_TEXT.error} ${error instanceof Error ? error.message : ""}`.trim(), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={className}
        onClick={handleExport}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? UI_TEXT.loading : UI_TEXT.label}
      </button>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 12,
            color: "#fff",
            background: toast.type === "success" ? "#16a34a" : "#dc2626",
            zIndex: 20,
            maxWidth: 280,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
