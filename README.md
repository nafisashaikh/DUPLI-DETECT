# DUPLI-DETECT — Multilingual Duplicate Detection

Complete full-stack system for detecting duplicate records in multilingual datasets (English, Japanese, Chinese, Thai, Bahasa, Arabic, etc.).

## Stack

- Frontend: Next.js (App Router)
- Backend: FastAPI (Python)
- DB: Firebase Firestore (with in-memory fallback for local testing)
- NLP model: sentence-transformers `paraphrase-multilingual-MiniLM-L12-v2`

## Configuration (No Hard-Coding)

Backend (environment variables):

- `MODEL_NAME` (default: `paraphrase-multilingual-MiniLM-L12-v2`)
- `DUPLICATE_THRESHOLD` (default: `0.70`, range `0..1`)
- `USE_SQLITE` (default: `true`) — enables persistent local storage when Firebase is not configured
- `SQLITE_PATH` (default: `backend/duplidetect.sqlite`) — path to the SQLite database file

Frontend (environment variables):

- `NEXT_PUBLIC_API_URL` (default: `http://127.0.0.1:8000`)
- `NEXT_PUBLIC_DEFAULT_THRESHOLD` (default: `0.7`)
  - You may also set it as a percent like `70`.
- `NEXT_PUBLIC_BULK_CHUNK_SIZE` (default: `200`)

Tip: copy `.env.example` → `.env.local` for local overrides.

## Implemented Features

### 1) Duplicate Detection (Core)

- Input: two texts
- Output: duplicate decision (`is_duplicate`) with preprocessing
- Preprocessing includes:

1. lowercasing
2. Unicode normalization
3. whitespace cleanup
4. removal of zero-width chars

### 2) Similarity Score (Core)

- Multilingual sentence embeddings
- Cosine similarity
- Output score in percentage (`0-100`)

### 3) Duplicate Type Classification

- `typo`
- `language_difference`
- `semantic`
- `not_duplicate`

### 4) Real-time Search & Suggestions

- Debounced real-time search while typing
- Returns top similar records above a threshold (default `70%`)
- Warns user before adding probable duplicate

### 5) Visual Dashboard (Advanced)

- Similarity graph rendered on Canvas
- Nodes = records
- Edges = similarity links
- Duplicate clusters grouped by color

## Folder Structure

```text
dupli-detect/
  app/
    compare/page.tsx      # Compare 2 records
    search/page.tsx       # Real-time search + add-record warning
    dashboard/page.tsx    # Graph visualization
    layout.tsx
    page.tsx
    globals.css
  backend/
    main.py               # FastAPI endpoints + NLP + Firestore integration
    requirements.txt
  components/
    Navbar.tsx
  lib/
    api.ts                # Frontend API client
    types.ts              # Shared response/request types
```

## API Design

Base URL: `http://127.0.0.1:8000`

### POST `/compare`

Request:

```json
{
  "text1": "Login issue",
  "text2": "ログイン問題"
}
```

Response:

```json
{
  "text1": "Login issue",
  "text2": "ログイン問題",
  "similarity_score": 93.91,
  "is_duplicate": true,
  "duplicate_type": "language_difference",
  "lang1": "en",
  "lang2": "ja"
}
```

### POST `/search`

Request:

```json
{
  "query": "Login problem",
  "threshold": 0.7
}
```

Response:

```json
{
  "input": "Login problem",
  "matches": [
    { "id": "abc1", "text": "Login issue", "similarity": 88.3, "language": "en" },
    { "id": "abc2", "text": "Cannot log in", "similarity": 81.4, "language": "en" }
  ]
}
```

### POST `/add-record`

Request:

```json
{
  "text": "Login issue",
  "threshold": 0.7
}
```

Duplicate warning response:

```json
{
  "id": "",
  "text": "Login issue",
  "language": "en",
  "inserted": false,
  "warning": "Possible duplicate detected (similarity 91.2%)",
  "top_match": {
    "id": "abc1",
    "text": "Cannot log in",
    "similarity": 91.2,
    "language": "en"
  }
}
```

Insert success response:

```json
{
  "id": "new_id",
  "text": "Login issue",
  "language": "en",
  "inserted": true,
  "warning": null,
  "top_match": null
}
```

## Firestore Schema

Collection: `records`

```json
{
  "id": "auto-id",
  "text": "Login issue",
  "language": "en",
  "embedding": [0.012, -0.088, 0.34]
}
```

## Local Setup

### 1) Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

Backend docs: `http://127.0.0.1:8000/docs`

### 2) Frontend

```powershell
cd ..
npm install
npm run dev
```

Frontend: `http://localhost:3000`

## Firebase Setup (Optional)

If Firebase credentials are present, FastAPI uses Firestore; otherwise it falls back to in-memory store.

1. Create Firebase service account JSON.
2. Save it as `backend/firebase-credentials.json` or set env var:

```powershell
$env:FIREBASE_CREDENTIALS="C:\path\to\firebase-credentials.json"
```

1. Restart backend.

## Notes

- Language detection is best-effort (`langdetect`) and deterministic seed is enabled.
- Duplicate threshold default is `0.70`.
- Embedding model loads lazily on first request.

## Evaluation (PS Submission Helper)

Run a quick offline evaluation on labeled multilingual pairs:

```powershell
cd backend
python evaluate.py --pairs eval_pairs.jsonl --threshold 0.70
```

The script prints per-pair similarity + a final summary with precision/recall/F1.

To automatically recommend a threshold (best F1 on your labeled set):

```powershell
cd backend
python evaluate.py --pairs eval_pairs.jsonl --sweep
```

To try a different multilingual model for your PS comparison:

```powershell
cd backend
python evaluate.py --pairs eval_pairs.jsonl --sweep --model sentence-transformers/LaBSE
```
