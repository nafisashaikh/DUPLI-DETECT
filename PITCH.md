90-Second Pitch — DupliDetect

- Problem (15s): Global datasets are messy — the same entity appears in many forms. "Apple", "りんご", and "تفاحة" all refer to the same thing, but naive systems treat them as different.

- Solution (30s): DupliDetect combines three AI "brains":
  - Brain 1 — Semantic embeddings that understand meaning across 50+ languages.
  - Brain 2 — Phonetic comparison (transliteration + edit distance) to catch sound-alike duplicates.
  - Brain 3 — Concept matching using a curated multilingual concept map to encode domain knowledge.

- Demo Hook (30s): One click loads a multilingual dataset, runs clustering, and shows explainable duplicate groups. Judges see clustered duplicates, reason summaries, and can export cleaned CSV instantly.

- Bonus (15s): Offline OCR + deduplication: upload scanned invoices, extract text via local OCR integration, and deduplicate — all runnable locally for secure offline demos.

Talking tips:
- Say the problem in human terms, then show one concrete example (EN → JP). Emphasize explainability: each duplicate shows *why* it matched.
- If time, show PDF upload deduplication as a surprise feature.
