# DupliDetect — Project Summary

## Project Overview

DupliDetect is a multilingual duplicate-detection web app and API. It combines three "brains":
- Brain 1 — semantic embeddings (sentence-transformers)
- Brain 2 — phonetic similarity via Epitran + Levenshtein
- Brain 3 — lightweight concept matching using a static concept map

The backend is a FastAPI service (embeddings, similarity, deduplication, clustering, PDF OCR processing). The frontend is a Next.js app that provides UI for compare/search/cluster/upload and dashboard functionality.

## Core Features

- Instant text comparison (cross-lingual)
- Search similar records in existing dataset
- Bulk upload with duplicate detection
- PDF OCR extraction (NVIDIA Nemotron OCR integration optional) and CSV conversion
- DBSCAN clustering over a three-brain distance matrix
- Local fallback store: SQLite or in-memory (Firestore optional)
- Lightweight concept matching via `concept_map.json`

## Backend (key files)

- [backend/main.py](backend/main.py) — main FastAPI app; endpoints, Pydantic models, embedding index, storage
- [backend/concept.py](backend/concept.py) — `ConceptMatcher` and `get_concept_score()` (Brain 3)
- [backend/phonetic.py](backend/phonetic.py) — `get_phonetic_similarity()` (Brain 2)
- [backend/swagger.json](backend/swagger.json) — OpenAPI spec exported for the API
- [backend/evaluate.py](backend/evaluate.py) — evaluation helpers (analysis tools)
- [backend/generate_swagger_json.py](backend/generate_swagger_json.py) — helper to emit swagger

See also: [backend/requirements.txt](backend/requirements.txt)

## Backend Pydantic models (defined in `main.py`)

- `CompareRequest`, `CompareResponse`
- `SearchRequest`, `SearchMatch`, `SearchResponse`
- `AddRecordRequest`, `AddRecordResponse`
- `BulkRecordItem`, `BulkAddRequest`, `BulkAddResponse`
- `PDFProcessRequest`, `PDFProcessResponse`
- `Record` (stored-record model)
- `ClusterRequest`, `ClusterResponse`, `ClusterGroup`, `ClusterItem`

These models are used by the endpoints and fully documented in [backend/swagger.json](backend/swagger.json).

## Backend API Endpoints (summary)

- GET `/` — redirects to `/docs` (OpenAPI UI)
- GET `/health` — health and config info
- POST `/compare` — compare two texts (returns semantic/phonetic/concept/final score + verdict)
- POST `/search` — search similar stored records (threshold param)
- POST `/cluster` — cluster list of texts (DBSCAN over three-brain distance)
- POST `/add-record` — add a single record (duplicate check before insert)
- POST `/add-records-bulk` — bulk insert with deduplication
- POST `/process-pdf` — upload PDF, OCR -> CSV, optionally deduplicate and insert
- GET `/records` — list stored records
- DELETE `/records/{record_id}` — delete a record

For full request/response schemas and example payloads see: [backend/swagger.json](backend/swagger.json)

## Frontend (key files & pages)

- [app/page.tsx](app/page.tsx) — Home / Landing (links to core features)
- [app/compare/page.tsx](app/compare/page.tsx) — Compare UI (calls `/compare`)
- [app/search/page.tsx](app/search/page.tsx) — Search UI (calls `/search`)
- [app/dashboard/page.tsx](app/dashboard/page.tsx) — Visual dashboard (graphing/summary)
- [app/cluster/page.tsx](app/cluster/page.tsx) — Cluster UI (calls `/cluster`)
- [app/upload/page.tsx](app/upload/page.tsx) — Upload / PDF processing UI (calls `/process-pdf` and bulk APIs)
- [app/layout.tsx](app/layout.tsx) — global layout and `Navbar`

Frontend helper libraries:
- [lib/api.ts](lib/api.ts) — client wrappers for all backend endpoints (compare, search, add-record, bulk, processPDF, demo utilities)
- [lib/config.ts](lib/config.ts) and [lib/types.ts](lib/types.ts) — types and config

UI components (not exhaustive):
- [components/BrainScores.js](components/BrainScores.js) — displays semantic/phonetic/concept scores and UI controls
- [components/DemoDataLoader.js](components/DemoDataLoader.js)
- [components/GroupSummaryCard.js](components/GroupSummaryCard.js)
- [components/Navbar.tsx](components/Navbar.tsx)
- [components/ReportExporter.js](components/ReportExporter.js)

## Important client-side routes and links

- Home: `/` — [app/page.tsx](app/page.tsx)
- Compare: `/compare` — [app/compare/page.tsx](app/compare/page.tsx)
- Search: `/search` — [app/search/page.tsx](app/search/page.tsx)
- Dashboard: `/dashboard` — [app/dashboard/page.tsx](app/dashboard/page.tsx)
- Cluster: `/cluster` — [app/cluster/page.tsx](app/cluster/page.tsx)
- Upload: `/upload` — [app/upload/page.tsx](app/upload/page.tsx)

Buttons and links in pages typically call functions in [lib/api.ts](lib/api.ts).

## How the three brains combine

- Brain 1 (semantic): sentence-transformers embeddings (default `paraphrase-multilingual-MiniLM-L12-v2`) → cosine similarity
- Brain 2 (phonetic): language detection + Epitran transliteration + Levenshtein → phonetic similarity (fallback=0.5)
- Brain 3 (concept): reverse-indexed concept map (`concept_map.json`) → binary concept match (0.0/1.0)
- Final combined score is a weighted average (configurable via env or request body). Duplicate threshold configurable via `DUPLICATE_THRESHOLD`.

## Environment variables & runtime notes

- `MODEL_NAME` — sentence-transformers model (default `paraphrase-multilingual-MiniLM-L12-v2`)
- `DUPLICATE_THRESHOLD` — 0..1 duplicate cutoff (default 0.70)
- `USE_SQLITE` — use SQLite fallback (default true)
- `SQLITE_PATH` — sqlite file path (default `backend/duplidetect.sqlite`)
- `NVIDIA_API_KEY` — optional key for NVIDIA OCR integration
- `CONCEPT_MAP_PATH` — optional path to concept map JSON

## How to run (development)

1. Start backend (from `backend/`):

```powershell
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --reload --port 8000
```

2. Start frontend (from repo root):

```bash
npm install
npm run dev
```

Change `NEXT_PUBLIC_API_URL` to point to `http://localhost:8000` if needed.

## Notable files to inspect

- API surface and schemas: [backend/swagger.json](backend/swagger.json)
- Backend logic & endpoints: [backend/main.py](backend/main.py)
- Concept matcher: [backend/concept.py](backend/concept.py)
- Phonetic similarity: [backend/phonetic.py](backend/phonetic.py)
- Frontend API client: [lib/api.ts](lib/api.ts)
- Main UI pages: [app/page.tsx](app/page.tsx), [app/compare/page.tsx](app/compare/page.tsx), [app/search/page.tsx](app/search/page.tsx)

## Suggestions / Next steps

- (Optional) Run the backend and open `/docs` to see full interactive API docs.
- Populate or review `concept_map.json` to tune concept-matching.
- If using OCR at scale, provide `NVIDIA_API_KEY` and ensure `requests`, `pandas`, `Pillow` are installed.

---

Generated summary file: `sum.md`
