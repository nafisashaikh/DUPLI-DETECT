"""
DupliDetect — Multilingual Duplicate Detection API
FastAPI backend with sentence-transformers, Firebase Firestore, and langdetect
"""
from __future__ import annotations

import os
import re
import unicodedata
from typing import Any, Optional

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Lazy-loaded heavy dependencies
# ---------------------------------------------------------------------------
_model = None
_db = None   # Firestore client (optional — gracefully degraded)
_langdetect_seeded = False

COLLECTION = "records"
DUPLICATE_THRESHOLD = 0.70          # 70 % similarity → warn as duplicate
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# ---------------------------------------------------------------------------
# Firebase initialisation (graceful — works without credential file)
# ---------------------------------------------------------------------------
def _get_db():
    global _db
    if _db is not None:
        return _db
    cred_path = os.environ.get("FIREBASE_CREDENTIALS", "firebase-credentials.json")
    if not os.path.exists(cred_path):
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fs
        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        _db = fs.client()
        return _db
    except Exception as exc:
        print(f"[Firebase] Could not initialise: {exc}")
        return None

# ---------------------------------------------------------------------------
# Sentence-Transformers model (loaded once on first request)
# ---------------------------------------------------------------------------
def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
    return _model

# ---------------------------------------------------------------------------
# Text preprocessing
# ---------------------------------------------------------------------------
def preprocess(text: str) -> str:
    """Lowercase, normalize Unicode, remove combining marks, collapse whitespace."""
    text = text.lower().strip()
    text = unicodedata.normalize("NFKC", text)          # Canonical + compatibility normalization
    # Strip combining marks for Latin-script typo tolerance without altering CJK tokens.
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text)
                   if not unicodedata.combining(ch))
    text = re.sub(r"[\u200b-\u200d\ufeff]", "", text)   # zero-width chars
    text = re.sub(r"\s+", " ", text)
    return text

# ---------------------------------------------------------------------------
# Embedding & similarity
# ---------------------------------------------------------------------------
def embed(text: str) -> np.ndarray:
    return _get_model().encode(preprocess(text), normalize_embeddings=True)

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))          # vectors already L2-normalised

# ---------------------------------------------------------------------------
# Duplicate type classification
# ---------------------------------------------------------------------------
def _detect_language(text: str) -> str:
    global _langdetect_seeded
    try:
        from langdetect import DetectorFactory, detect
        if not _langdetect_seeded:
            DetectorFactory.seed = 0
            _langdetect_seeded = True
        return detect(text)
    except Exception:
        return "unknown"

def _levenshtein_ratio(a: str, b: str) -> float:
    try:
        from Levenshtein import ratio
        return ratio(a, b)
    except ImportError:
        # Fallback: standard edit-distance dynamic programming.
        la, lb = len(a), len(b)
        if la == 0 and lb == 0:
            return 1.0
        dp = list(range(lb + 1))
        for i, ca in enumerate(a, 1):
            prev_diag = dp[0]
            dp[0] = i
            for j, cb in enumerate(b, 1):
                old_above = dp[j]
                if ca == cb:
                    dp[j] = prev_diag
                else:
                    dp[j] = 1 + min(prev_diag, old_above, dp[j - 1])
                prev_diag = old_above
        return 1 - dp[lb] / max(la, lb)

def classify_duplicate_type(text1: str, text2: str, sim_score: float) -> str:
    """Classify the nature of the duplicate relationship."""
    p1, p2 = preprocess(text1), preprocess(text2)
    lang1, lang2 = _detect_language(p1), _detect_language(p2)
    lev = _levenshtein_ratio(p1, p2)

    if lev >= 0.92 and (lang1 == lang2 or "unknown" in (lang1, lang2)):
        return "typo"
    if sim_score >= DUPLICATE_THRESHOLD and lang1 != lang2 and lang1 != "unknown" and lang2 != "unknown":
        return "language_difference"
    if sim_score >= DUPLICATE_THRESHOLD:
        return "semantic"
    return "not_duplicate"

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="DupliDetect API",
    description="Multilingual duplicate detection using sentence-transformers",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class CompareRequest(BaseModel):
    text1: str
    text2: str

class CompareResponse(BaseModel):
    text1: str
    text2: str
    similarity_score: float          # 0-100
    is_duplicate: bool
    duplicate_type: str
    lang1: str
    lang2: str

class SearchRequest(BaseModel):
    query: str
    threshold: Optional[float] = DUPLICATE_THRESHOLD

class SearchMatch(BaseModel):
    id: str
    text: str
    similarity: float
    language: str

class SearchResponse(BaseModel):
    input: str
    matches: list[SearchMatch]

class AddRecordRequest(BaseModel):
    text: str

class AddRecordResponse(BaseModel):
    id: str
    text: str
    language: str
    inserted: bool
    warning: Optional[str] = None
    top_match: Optional[SearchMatch] = None

class Record(BaseModel):
    id: str
    text: str
    language: str

# ---------------------------------------------------------------------------
# In-memory fallback store when Firebase is unavailable
# ---------------------------------------------------------------------------
_memory_store: dict[str, dict[str, Any]] = {}
_id_counter = 0

def _next_id() -> str:
    global _id_counter
    _id_counter += 1
    return f"mem_{_id_counter}"

def _all_records() -> list[dict[str, Any]]:
    db = _get_db()
    if db:
        docs = db.collection(COLLECTION).stream()
        return [{"id": d.id, **d.to_dict()} for d in docs]
    return list(_memory_store.values())

def _add_record_store(text: str, language: str, embedding: list[float]) -> str:
    db = _get_db()
    if db:
        doc_ref = db.collection(COLLECTION).document()
        doc_ref.set({"text": text, "language": language, "embedding": embedding})
        return doc_ref.id
    rid = _next_id()
    _memory_store[rid] = {"id": rid, "text": text, "language": language, "embedding": embedding}
    return rid

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
from fastapi.responses import RedirectResponse

@app.get("/")
def root():
    return RedirectResponse(url="/docs")

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return {}

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "firebase": _get_db() is not None}


@app.post("/compare", response_model=CompareResponse)
def compare(req: CompareRequest):
    if not req.text1.strip() or not req.text2.strip():
        raise HTTPException(400, "Both text1 and text2 must be non-empty")
    emb1 = embed(req.text1)
    emb2 = embed(req.text2)
    sim = cosine_similarity(emb1, emb2)
    sim_pct = round(sim * 100, 2)
    dup_type = classify_duplicate_type(req.text1, req.text2, sim)
    is_dup = dup_type != "not_duplicate"
    return CompareResponse(
        text1=req.text1,
        text2=req.text2,
        similarity_score=sim_pct,
        is_duplicate=is_dup,
        duplicate_type=dup_type,
        lang1=_detect_language(preprocess(req.text1)),
        lang2=_detect_language(preprocess(req.text2)),
    )


@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest):
    if not req.query.strip():
        raise HTTPException(400, "Query must be non-empty")
    threshold = req.threshold if req.threshold is not None else DUPLICATE_THRESHOLD
    threshold = max(0.0, min(1.0, threshold))
    query_emb = embed(req.query)
    records = _all_records()
    results: list[SearchMatch] = []
    for rec in records:
        emb = rec.get("embedding")
        if emb is None:
            emb = embed(rec["text"]).tolist()
        sim = cosine_similarity(query_emb, np.array(emb, dtype=np.float32))
        if sim >= threshold:
            results.append(SearchMatch(
                id=rec["id"],
                text=rec["text"],
                similarity=round(sim * 100, 2),
                language=rec.get("language", "unknown"),
            ))
    results.sort(key=lambda x: x.similarity, reverse=True)
    return SearchResponse(input=req.query, matches=results[:10])


@app.post("/add-record", response_model=AddRecordResponse)
def add_record(req: AddRecordRequest):
    if not req.text.strip():
        raise HTTPException(400, "text must be non-empty")
    lang = _detect_language(preprocess(req.text))
    emb = embed(req.text)
    # Check for duplicates first
    records = _all_records()
    top_match: Optional[SearchMatch] = None
    max_sim = 0.0
    for rec in records:
        stored_emb = rec.get("embedding")
        if stored_emb is None:
            stored_emb = embed(rec["text"]).tolist()
        sim = cosine_similarity(emb, np.array(stored_emb, dtype=np.float32))
        if sim > max_sim:
            max_sim = sim
            if sim >= DUPLICATE_THRESHOLD:
                top_match = SearchMatch(
                    id=rec["id"],
                    text=rec["text"],
                    similarity=round(sim * 100, 2),
                    language=rec.get("language", "unknown"),
                )

    if top_match:
        return AddRecordResponse(
            id="",
            text=req.text,
            language=lang,
            inserted=False,
            warning=f"Possible duplicate detected (similarity {top_match.similarity}%)",
            top_match=top_match,
        )

    rid = _add_record_store(req.text, lang, emb.tolist())
    return AddRecordResponse(id=rid, text=req.text, language=lang, inserted=True)


@app.get("/records", response_model=list[Record])
def list_records():
    return [Record(id=r["id"], text=r["text"], language=r.get("language", "unknown"))
            for r in _all_records()]


@app.delete("/records/{record_id}")
def delete_record(record_id: str):
    db = _get_db()
    if db:
        db.collection(COLLECTION).document(record_id).delete()
    else:
        _memory_store.pop(record_id, None)
    return {"deleted": record_id}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
