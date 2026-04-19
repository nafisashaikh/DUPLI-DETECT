// Shared TypeScript types for DupliDetect

export interface ScoreWeights {
  semantic: number;
  phonetic: number;
  concept: number;
}

export interface CompareResult {
  text1: string;
  text2: string;
  semantic_score: number;
  phonetic_score: number;
  concept_score: number;
  combined_score: number;
  similarity_score: number;   // 0-100 combined score for backward compatibility
  threshold: number;
  weights: ScoreWeights;
  is_duplicate: boolean;
  duplicate_type: "typo" | "language_difference" | "semantic" | "phonetic" | "concept" | "not_duplicate";
  lang1: string;
  lang2: string;
}

export interface SearchMatch {
  id: string;
  text: string;
  similarity: number;   // 0-100
  language: string;
  item?: string;
  description?: string;
  amount?: string;
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
  item?: string;
  description?: string;
  amount?: string;
}

export interface BulkAddResponse {
  total: number;
  added: number;
  duplicates: number;
  failed: number;
  results: AddRecordResponse[];
}
