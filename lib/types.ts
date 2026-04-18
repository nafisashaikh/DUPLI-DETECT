// Shared TypeScript types for DupliDetect

export interface CompareResult {
  text1: string;
  text2: string;
  similarity_score: number;   // 0-100
  is_duplicate: boolean;
  duplicate_type: "typo" | "language_difference" | "semantic" | "not_duplicate";
  lang1: string;
  lang2: string;
}

export interface SearchMatch {
  id: string;
  text: string;
  similarity: number;   // 0-100
  language: string;
}

export interface SearchResponse {
  input: string;
  matches: SearchMatch[];
}

export interface AddRecordResponse {
  id: string;
  text: string;
  language: string;
  inserted: boolean;
  warning?: string;
  top_match?: SearchMatch;
}

export interface Record {
  id: string;
  text: string;
  language: string;
}

export interface BulkAddResponse {
  total: number;
  added: number;
  duplicates: number;
  failed: number;
  results: AddRecordResponse[];
}
