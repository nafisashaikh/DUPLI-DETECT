// API client for DupliDetect
import type { CompareResult, SearchResponse, AddRecordResponse, Record as DDRecord } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`API ${path}: ${res.status} — ${msg}`);
  }
  return res.json() as Promise<T>;
}

export function compareTexts(text1: string, text2: string): Promise<CompareResult> {
  return api<CompareResult>("/compare", {
    method: "POST",
    body: JSON.stringify({ text1, text2 }),
  });
}

export function searchSimilar(query: string, threshold = 0.7): Promise<SearchResponse> {
  return api<SearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ query, threshold }),
  });
}

export function addRecord(text: string): Promise<AddRecordResponse> {
  return api<AddRecordResponse>("/add-record", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function listRecords(): Promise<DDRecord[]> {
  return api<DDRecord[]>("/records");
}

export function deleteRecord(id: string): Promise<{ deleted: string }> {
  return api<{ deleted: string }>(`/records/${id}`, { method: "DELETE" });
}
