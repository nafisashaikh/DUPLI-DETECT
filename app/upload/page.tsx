"use client";
import { useState, useRef } from "react";
import styles from "./upload.module.css";

interface PDFProcessResult {
  filename: string;
  extracted_text: string;
  csv_data: string;
  processed_records: number;
  duplicates_found: number;
  records_added: number;
  results: Array<{
    id: string;
    text: string;
    language: string;
    inserted: boolean;
    warning?: string;
    top_match?: {
      id: string;
      text: string;
      similarity: number;
      language: string;
    };
  }>;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<PDFProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deduplicate, setDeduplicate] = useState(true);
  const [threshold, setThreshold] = useState(70);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
        setError("Please select a PDF file");
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) { // 10MB
        setError("File size must be less than 10MB");
        return;
      }
      setFile(selectedFile);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Build URL with query parameters
      const params = new URLSearchParams();
      params.append('deduplicate', deduplicate.toString());
      params.append('threshold', (threshold / 100).toString());

      const response = await fetch(`http://127.0.0.1:8000/process-pdf?${params.toString()}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
      }

      const data: PDFProcessResult = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const downloadCSV = () => {
    if (!result) return;

    const blob = new Blob([result.csv_data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.filename.replace('.pdf', '')}_extracted.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.container}>
      <h1>PDF OCR Processing</h1>
      <p>Upload a PDF bill and extract text using NVIDIA Nemotron-OCR-v1. The extracted data will be converted to CSV format and deduplicated against existing records.</p>

      <div className={styles.uploadSection}>
        <div className={styles.fileInput}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={styles.selectButton}
          >
            {file ? file.name : "Select PDF File"}
          </button>
        </div>

        <div className={styles.options}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
            />
            Enable deduplication
          </label>

          {deduplicate && (
            <div className={styles.threshold}>
              <label>Similarity threshold: {threshold}%</label>
              <input
                type="range"
                min="50"
                max="95"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className={styles.slider}
              />
            </div>
          )}
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className={styles.uploadButton}
        >
          {uploading ? "Processing..." : "Process PDF"}
        </button>
      </div>

      {error && (
        <div className={styles.error}>
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className={styles.result}>
          <h2>Processing Results</h2>

          <div className={styles.summary}>
            <div className={styles.stat}>
              <strong>File:</strong> {result.filename}
            </div>
            <div className={styles.stat}>
              <strong>Records Processed:</strong> {result.processed_records}
            </div>
            <div className={styles.stat}>
              <strong>Duplicates Found:</strong> {result.duplicates_found}
            </div>
            <div className={styles.stat}>
              <strong>Records Added:</strong> {result.records_added}
            </div>
          </div>

          <div className={styles.actions}>
            <button onClick={downloadCSV} className={styles.downloadButton}>
              Download CSV
            </button>
          </div>

          <div className={styles.extractedText}>
            <h3>Extracted Text</h3>
            <pre className={styles.textContent}>{result.extracted_text}</pre>
          </div>

          <div className={styles.csvPreview}>
            <h3>CSV Data Preview</h3>
            <pre className={styles.csvContent}>{result.csv_data}</pre>
          </div>

          <div className={styles.processingResults}>
            <h3>Processing Results</h3>
            <div className={styles.resultsList}>
              {result.results.map((item, index) => (
                <div key={index} className={`${styles.resultItem} ${item.inserted ? styles.success : styles.duplicate}`}>
                  <div className={styles.resultText}>
                    <strong>{item.inserted ? "✓ Added" : "⚠ Duplicate"}</strong>: {item.text}
                  </div>
                  {item.warning && (
                    <div className={styles.warning}>{item.warning}</div>
                  )}
                  {item.top_match && (
                    <div className={styles.match}>
                      Similar to: "{item.top_match.text}" ({item.top_match.similarity}% similarity)
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}