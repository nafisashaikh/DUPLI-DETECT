// API client for DupliDetect
import type { CompareResult, SearchResponse, AddRecordResponse, BulkAddResponse, Record as DDRecord } from "./types";
import { defaultThreshold01, defaultBulkChunkSize } from "./config";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

function fallbackBases(base: string): string[] {
  const b = base.replace(/\/$/, "");
  if (b.includes("localhost")) return [b.replace("localhost", "127.0.0.1")];
  if (b.includes("127.0.0.1")) return [b.replace("127.0.0.1", "localhost")];
  return [];
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response | undefined;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (e: unknown) {
    for (const fb of fallbackBases(BASE)) {
      try {
        res = await fetch(`${fb}${path}`, {
          headers: { "Content-Type": "application/json" },
          ...options,
        });
        break;
      } catch {
        // keep trying fallbacks
      }
    }

    if (!res) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`API ${path}: failed to reach ${BASE} (${detail}). Is the backend running?`);
    }
  }
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`API ${path}: ${res.status} — ${msg}`);
  }
  return res.json() as Promise<T>;
}

export function compareTexts(
  text1: string,
  text2: string,
  options?: {
    threshold?: number;
    semanticWeight?: number;
    phoneticWeight?: number;
    conceptWeight?: number;
  }
): Promise<CompareResult> {
  const payload: Record<string, unknown> = { text1, text2 };
  if (options?.threshold !== undefined) {
    payload.threshold = options.threshold;
  }
  const weights: Record<string, number> = {};
  if (options?.semanticWeight !== undefined) weights.semantic = options.semanticWeight;
  if (options?.phoneticWeight !== undefined) weights.phonetic = options.phoneticWeight;
  if (options?.conceptWeight !== undefined) weights.concept = options.conceptWeight;
  if (Object.keys(weights).length > 0) {
    payload.weights = weights;
  }

  return api<CompareResult>("/compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function searchSimilar(query: string, threshold = defaultThreshold01()): Promise<SearchResponse> {
  return api<SearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ query, threshold }),
  });
}

export function addRecord(text: string, threshold?: number): Promise<AddRecordResponse> {
  return api<AddRecordResponse>("/add-record", {
    method: "POST",
    body: JSON.stringify({ text, threshold }),
  });
}

export type BulkAddProgress = {
  done: number;
  total: number;
  added: number;
  duplicates: number;
  failed: number;
};

export type BulkAddResult = BulkAddProgress & {
  results: AddRecordResponse[];
  errors: { text: string; error: string }[];
};

export async function addRecordsBulk(
  texts: string[],
  options?: { concurrency?: number; onProgress?: (p: BulkAddProgress) => void }
): Promise<BulkAddResult> {
  const total = texts.length;
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, 8));

  const progress: BulkAddProgress = { done: 0, total, added: 0, duplicates: 0, failed: 0 };
  const results: AddRecordResponse[] = [];
  const errors: { text: string; error: string }[] = [];

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const text = texts[i] ?? "";
      try {
        const r = await addRecord(text);
        results.push(r);
        if (r.inserted) progress.added += 1;
        else progress.duplicates += 1;
      } catch (e: unknown) {
        progress.failed += 1;
        errors.push({ text, error: e instanceof Error ? e.message : String(e) });
      } finally {
        progress.done += 1;
        options?.onProgress?.({ ...progress });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return { ...progress, results, errors };
}

export function addRecordsBulkServer(texts: string[], threshold?: number): Promise<BulkAddResponse> {
  return api<BulkAddResponse>("/add-records-bulk", {
    method: "POST",
    body: JSON.stringify({ texts, threshold }),
  });
}

export async function addRecordsBulkServerChunked(
  texts: string[],
  options?: {
    chunkSize?: number;
    threshold?: number;
    onProgress?: (p: BulkAddProgress) => void;
  }
): Promise<BulkAddResponse> {
  const chunkSize = Math.max(1, Math.min(options?.chunkSize ?? defaultBulkChunkSize(), 2000));
  const total = texts.length;
  const progress: BulkAddProgress = { done: 0, total, added: 0, duplicates: 0, failed: 0 };
  const all: BulkAddResponse = { total, added: 0, duplicates: 0, failed: 0, results: [] };

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    const r = await addRecordsBulkServer(chunk, options?.threshold);
    all.added += r.added;
    all.duplicates += r.duplicates;
    all.failed += r.failed;
    all.results.push(...r.results);

    progress.done = Math.min(total, i + chunk.length);
    progress.added = all.added;
    progress.duplicates = all.duplicates;
    progress.failed = all.failed;
    options?.onProgress?.({ ...progress });
  }

  return all;
}

export function listRecords(): Promise<DDRecord[]> {
  return api<DDRecord[]>("/records");
}

export async function exportCSV(): Promise<string> {
  const res = await fetch(`${BASE}/export-csv`);
  if (!res.ok) {
    throw new Error(`API /export-csv: ${res.status} — ${await res.text()}`);
  }
  return res.text();
}

export function deleteRecord(id: string): Promise<{ deleted: string }> {
  return api<{ deleted: string }>(`/records/${id}`, { method: "DELETE" });
}

export interface PDFProcessResult {
  filename: string;
  extracted_text: string;
  csv_data: string;
  processed_records: number;
  duplicates_found: number;
  records_added: number;
  results: AddRecordResponse[];
}

export async function processPDF(
  file: File,
  options?: { deduplicate?: boolean; threshold?: number }
): Promise<PDFProcessResult> {
  const formData = new FormData();
  formData.append('file', file);

  // Add query parameters
  const params = new URLSearchParams();
  if (options?.deduplicate !== undefined) {
    params.append('deduplicate', options.deduplicate.toString());
  }
  if (options?.threshold !== undefined) {
    params.append('threshold', options.threshold.toString());
  }

  const url = params.toString() ? `/process-pdf?${params.toString()}` : '/process-pdf';

  return api<PDFProcessResult>(url, {
    method: 'POST',
    body: formData,
    headers: {
      // Don't set Content-Type, let the browser set it with boundary for FormData
    },
  });
}

export function getDemoData(): Promise<{ count: number; texts: string[]; description: string }> {
  return api("/demo-data");
}

export function loadDemoData(): Promise<BulkAddResponse> {
  return api<BulkAddResponse>("/load-demo-data", { method: "POST" });
}

export function clearAllRecords(): Promise<{ deleted: string; status: string }> {
  return api<{ deleted: string; status: string }>("/records", { method: "DELETE" });
}

export function getReport(): Promise<{
  title: string;
  timestamp: string;
  total_records: number;
  unique_languages: string[];
  duplicate_groups_detected: number;
  content: string;
}> {
  return api("/report");
}

export async function downloadReport(): Promise<string> {
  const res = await fetch(`${BASE}/report/download`);
  if (!res.ok) {
    throw new Error(`API /report/download: ${res.status} — ${await res.text()}`);
  }
  return res.text();
}


