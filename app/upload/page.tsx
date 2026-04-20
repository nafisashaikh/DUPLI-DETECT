"use client";
import React, { useState, useRef } from "react";
import styles from "./upload.module.css";
import toast from "@/lib/toast";

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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[] | null>(null);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif'];
      const ok = allowed.some(ext => selectedFile.name.toLowerCase().endsWith(ext));
      if (!ok) {
        setError("Please select a PDF or image file (png/jpg/tiff)");
        try { toast('Please select a PDF or image file (png/jpg/tiff)', { type: 'error' }); } catch {}
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) { // 10MB
        setError("File size must be less than 10MB");
        try { toast('File size must be less than 10MB', { type: 'error' }); } catch {}
        return;
      }
      setFile(selectedFile);
      // create image preview if image
      if (selectedFile.type.startsWith('image/')) {
        try {
          const url = URL.createObjectURL(selectedFile);
          setImagePreview(url);
        } catch (e) {
          setImagePreview(null);
        }
      } else {
        setImagePreview(null);
      }
      setError(null);
      setResult(null);
    }
  };

  // revoke object URL when file changes/unmount
  React.useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) {
      const fake = { target: { files: [f] } } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileSelect(fake);
    }
  };

  const LARGE_FILE_CONFIRM_BYTES = 2 * 1024 * 1024; // 2MB

  const parseCSV = (csv: string) => {
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return { headers: null, rows: [] };
    const splitRegex = /,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/;
    const headers = lines[0].split(splitRegex).map(h => h.replace(/^\"|\"$/g, '').trim());
    const rows = lines.slice(1).map(line => line.split(splitRegex).map(c => c.replace(/^\"|\"$/g, '').trim()));
    return { headers, rows };
  };

  const performUpload = async () => {
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

      const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";
      const url = `${baseUrl}/process-pdf?${params.toString()}`;
      const xhr = new XMLHttpRequest();
      const response = await new Promise<Response>((resolve, reject) => {
        xhr.open('POST', url, true);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          const status = xhr.status;
          const text = xhr.responseText;
          resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response);
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
      }

      const data: PDFProcessResult = await response.json();
      setResult(data);
      try { toast('PDF processed successfully', { type: 'success' }); } catch {}

      // parse csv for preview
      try {
        const parsed = parseCSV(data.csv_data);
        setCsvHeaders(parsed.headers);
        setCsvRows(parsed.rows);
        setCurrentPage(1);
      } catch (e) {
        setCsvHeaders(null);
        setCsvRows([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
      try { toast(msg, { type: 'error' }); } catch {}
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    // show confirmation modal for large files
    if (file.size > LARGE_FILE_CONFIRM_BYTES && !showConfirmModal) {
      setShowConfirmModal(true);
      return;
    }
    await performUpload();
  };

  const downloadCSV = () => {
    if (!result) return;

    const blob = new Blob([result.csv_data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // strip extension generically
    const base = result.filename.replace(/\.[^/.]+$/, "");
    a.download = `${base}_extracted.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.container}>
      <div className={`animate-fade-up ${styles.header}`}>
        <p className={styles.headerLabel}>Upload</p>
        <h1 className={styles.headerTitle}>Upload PDF</h1>
        <p className={styles.headerSubtitle}>Upload a PDF, image, or bill to extract structured rows. Results are converted to CSV and deduplicated against existing records.</p>
      </div>

      <div className={styles.uploadSection}>
          <div className={styles.fileInput}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`${styles.selectButton} ${dragOver ? styles.dropActive : ''}`}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{file ? file.name : 'Drop file (PDF / Image) or click to select'}</div>
                <div style={{ fontSize: '0.9rem', color: '#6b7280', marginTop: 8 }}>{file ? `${(file.size/1024/1024).toFixed(2)} MB` : 'Supported: PDF or image up to 10MB'}</div>
              </div>
            </div>
            {imagePreview && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Image preview</div>
                <img src={imagePreview} alt="preview" style={{ maxWidth: 320, maxHeight: 240, borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} />
              </div>
            )}
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

        <div style={{ marginTop: 12 }}>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className={styles.uploadButton}
          >
            {uploading ? (
              <>
                <span className={styles.spinner} style={{ marginRight: 8 }} /> Processing...
              </>
            ) : (
              'Process File'
            )}
          </button>
          {progress !== null && (
            <div style={{ marginTop: 10 }}>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{progress}%</div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.error}>
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className={styles.result}>
          <h2>Results</h2>

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
            <h3>CSV Preview</h3>
            {csvRows.length > 0 && csvHeaders ? (
              <div>
                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.csvTable}>
                    <thead>
                      <tr>
                        {csvHeaders.map((h, i) => <th key={i}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage).map((r, ri) => (
                        <tr key={ri}>
                          {r.map((c, ci) => <td key={ci}>{c}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.pagination}>
                  <div>
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={styles.pageBtn}>Prev</button>
                    <span style={{ margin: '0 8px' }}>Page {currentPage} / {Math.max(1, Math.ceil(csvRows.length / rowsPerPage))}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(Math.ceil(csvRows.length / rowsPerPage), p + 1))} disabled={currentPage >= Math.ceil(csvRows.length / rowsPerPage)} className={styles.pageBtn}>Next</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>Rows per page</label>
                    <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <pre className={styles.csvContent}>{result.csv_data}</pre>
            )}
          </div>

          <div className={styles.processingResults}>
            <h3>Record Details</h3>
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