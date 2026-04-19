# Test Validation Table for DupliDetect Multi-Brain Scoring

## Configuration
- **W_SEM (Brain 1 - Semantic)** = 0.4
- **W_PHO (Brain 2 - Phonetic)** = 0.3
- **W_CON (Brain 3 - Concept)** = 0.3
- **THRESHOLD (Duplicate Verdict)** = 0.75

---

## Test Case 1: Arabic Name Match (Mohammad vs محمد)

| Aspect | Value | Notes |
|--------|-------|-------|
| **Text 1** | Mohammad | English Latin script |
| **Text 2** | محمد | Arabic Arabic script |
| **Brain 1 (Semantic)** | 0.55 | Different scripts, meaning partially captured by embedding model |
| **Brain 2 (Phonetic)** | 0.65 | IPA transliteration: "mɑːˈhɑːməd" vs "muˈħɑːmmɑːd" → normalized Levenshtein distance ~0.65 |
| **Brain 3 (Concept)** | 0.0 | No shared knowledge concepts (names not in concept_map.json) |
| **Final Score Calc** | 0.4×0.55 + 0.3×0.65 + 0.3×0.0 = 0.22 + 0.195 + 0.0 = **0.415** | |
| **Expected Verdict** | ❌ NOT DUPLICATE | 0.415 < 0.75 threshold |
| **Reasoning** | Different scripts reduce semantic similarity, phonetic match is strong but insufficient to overcome weak semantic score |

---

## Test Case 2: English-Japanese Product Name (Apple vs アップル)

| Aspect | Value | Notes |
|--------|-------|-------|
| **Text 1** | Apple | English brand name |
| **Text 2** | アップル | Japanese katakana "appuru" (literal transliteration) |
| **Brain 1 (Semantic)** | 0.78 | Both refer to the same product concept; embeddings capture semantic similarity across scripts |
| **Brain 2 (Phonetic)** | 0.45 | Phonetic transliteration: "æpəl" (English) vs "ɑppɯɾɯ" (Japanese) → weakly related |
| **Brain 3 (Concept)** | 0.0 | "Apple" company exists in concept_map.json but "アップル" is not indexed as a term (term extraction uses script-aware matching) |
| **Final Score Calc** | 0.4×0.78 + 0.3×0.45 + 0.3×0.0 = 0.312 + 0.135 + 0.0 = **0.447** | |
| **Expected Verdict** | ❌ NOT DUPLICATE | 0.447 < 0.75 threshold |
| **Reasoning** | Strong semantic similarity offset by weak phonetic match; concept match fails due to term extraction limitations |

---

## Test Case 3: Multilingual Brand Match (Coca-Cola vs コカ・コーラ)

| Aspect | Value | Notes |
|--------|-------|-------|
| **Text 1** | Coca-Cola | English brand name with hyphen |
| **Text 2** | コカ・コーラ | Japanese katakana "Koka Kōra" with middle dot separator |
| **Brain 1 (Semantic)** | 0.82 | Both strongly associated with the same beverage brand; embedding model recognizes cross-script equivalence |
| **Brain 2 (Phonetic)** | 0.55 | IPA: "koʊkə koʊlə" (English) vs "kɔkɑ kɔːɾɑ" (Japanese) → similar structure but different vowels |
| **Brain 3 (Concept)** | 1.0 | ✅ **Concept Match!** "Coca-Cola" exists in concept_map.json as CONCEPT_BEVERAGE_COCA_COLA; term extraction identifies "Coca" and "Cola" in Text 1 and maps them to the concept; Text 2 uses reverse index lookup of individual characters/terms (partial match rules may vary by implementation) → **Assume 1.0 for strong brand recognition** |
| **Final Score Calc** | 0.4×0.82 + 0.3×0.55 + 0.3×1.0 = 0.328 + 0.165 + 0.3 = **0.793** | |
| **Expected Verdict** | ✅ DUPLICATE | 0.793 ≥ 0.75 threshold |
| **Reasoning** | Combination of high semantic match, moderate phonetic similarity, and strong concept match pushes final score above threshold → **DUPLICATE** |

---

## Validation Instructions

To verify these test cases in DUPLI-DETECT:

### Via cURL (Backend Only)
```bash
# Test Case 1
curl -X POST http://localhost:8000/compare \
  -H "Content-Type: application/json" \
  -d '{
    "text1": "Mohammad",
    "text2": "محمد",
    "weights": {"semantic": 0.4, "phonetic": 0.3, "concept": 0.3},
    "threshold": 0.75
  }'

# Test Case 2
curl -X POST http://localhost:8000/compare \
  -H "Content-Type: application/json" \
  -d '{
    "text1": "Apple",
    "text2": "アップル",
    "weights": {"semantic": 0.4, "phonetic": 0.3, "concept": 0.3},
    "threshold": 0.75
  }'

# Test Case 3
curl -X POST http://localhost:8000/compare \
  -H "Content-Type: application/json" \
  -d '{
    "text1": "Coca-Cola",
    "text2": "コカ・コーラ",
    "weights": {"semantic": 0.4, "phonetic": 0.3, "concept": 0.3},
    "threshold": 0.75
  }'
```

### Via Frontend UI
1. Navigate to `/compare` page
2. Enter Text 1 and Text 2 from each test case
3. Verify weights: Semantic=0.4, Phonetic=0.3, Concept=0.3
4. Verify threshold: Sensitivity=0.75
5. Check that `final_score` matches expected values (±0.05 tolerance)
6. Confirm verdict badge matches expected DUPLICATE/NOT DUPLICATE result

---

## Expected API Response Format

```json
{
  "is_duplicate": true,
  "semantic_score": 0.82,
  "phonetic_score": 0.55,
  "concept_score": 1.0,
  "final_score": 0.793,
  "explanation": "Concept match detected (Coca-Cola). Strong semantic similarity across scripts confirmed. Phonetic match moderate.",
  "threshold": 0.75
}
```

---

## Tolerance Levels

Due to model variations and numerical precision, allow these tolerances:
- **Semantic Score**: ±0.05 (models vary between sentence-transformer versions)
- **Phonetic Score**: ±0.03 (epitran language data may have minor updates)
- **Concept Score**: ±0.0 (binary: 0.0 or 1.0)
- **Final Score**: ±0.05 (propagated from component tolerances)
- **Verdict**: Must match expected result (NOT DUPLICATE or DUPLICATE)
