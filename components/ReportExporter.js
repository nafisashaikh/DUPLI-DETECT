/**
 * ReportExporter - Component for generating and downloading analysis reports
 */
"use client";
import { useState } from "react";
import { getReport, downloadReport } from "@/lib/api";

export default function ReportExporter() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerateReport = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getReport();
      setReport(data);
    } catch (e: any) {
      setError(`Failed to generate report: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    setLoading(true);
    setError("");
    try {
      const content = await downloadReport();
      const element = document.createElement("a");
      element.setAttribute(
        "href",
        `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`
      );
      element.setAttribute("download", "duplidetect_report.txt");
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch (e: any) {
      setError(`Failed to download report: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const containerStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
    padding: "16px",
    borderRadius: "8px",
    backgroundColor: "#f9fafb",
    border: "1px solid #e5e7eb",
  };

  const buttonGroupStyle = {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const,
  };

  const buttonStyle = {
    padding: "10px 16px",
    borderRadius: "6px",
    border: "none",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 200ms",
  };

  const generateButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#dbeafe",
    color: "#1e40af",
  };

  const downloadButtonStyle = {
    ...buttonStyle,
    backgroundColor: "#dcfce7",
    color: "#166534",
  };

  const reportStyle = {
    padding: "12px",
    borderRadius: "6px",
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    fontFamily: "monospace",
    fontSize: "11px",
    color: "#374151",
    maxHeight: "400px",
    overflowY: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    wordWrap: "break-word" as const,
  };

  const statStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
    marginBottom: "12px",
  };

  const statCardStyle = {
    padding: "10px",
    borderRadius: "6px",
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    textAlign: "center" as const,
  };

  const statValueStyle = {
    fontSize: "18px",
    fontWeight: "700",
    color: "#1f2937",
  };

  const statLabelStyle = {
    fontSize: "11px",
    color: "#6b7280",
    marginTop: "4px",
  };

  const errorStyle = {
    padding: "12px",
    borderRadius: "6px",
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fca5a5",
    fontSize: "13px",
  };

  return (
    <div style={containerStyle}>
      <div>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: "600" }}>
          📄 Analysis Report
        </h3>
        <p
          style={{
            margin: "0",
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          Generate a summary report of your records, groups, and duplicate analysis.
        </p>
      </div>

      <div style={buttonGroupStyle}>
        <button
          onClick={handleGenerateReport}
          disabled={loading}
          style={generateButtonStyle}
          title="Generate a summary report"
        >
          {loading ? "⏳ Generating..." : "📊 Generate Report"}
        </button>
        {report && (
          <button
            onClick={handleDownloadReport}
            disabled={loading}
            style={downloadButtonStyle}
            title="Download report as text file"
          >
            ⬇️ Download as Text
          </button>
        )}
      </div>

      {error && <div style={errorStyle}>❌ {error}</div>}

      {report && (
        <>
          <div style={statStyle}>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{report.total_records}</div>
              <div style={statLabelStyle}>Total Records</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>
                {report.unique_languages.length}
              </div>
              <div style={statLabelStyle}>Languages</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>
                {report.duplicate_groups_detected}
              </div>
              <div style={statLabelStyle}>Duplicate Groups</div>
            </div>
          </div>

          <div style={reportStyle}>{report.content}</div>
        </>
      )}
    </div>
  );
}
