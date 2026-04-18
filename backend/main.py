"""
DupliDetect — Multilingual Duplicate Detection API
FastAPI backend with sentence-transformers, Firebase Firestore, and langdetect
"""
from __future__ import annotations

import os
import re
import sqlite3
import unicodedata
import uuid
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
_sqlite = None  # SQLite connection (optional — persistent local fallback)
_langdetect_seeded = False

# ---------------------------------------------------------------------------
# Embedding index cache (in-process)
# Speeds up search + duplicate checks dramatically for bulk uploads.
# ---------------------------------------------------------------------------
_emb_dim: Optional[int] = None
_emb_index_dirty = True
_emb_index_ids: list[str] = []
_emb_index_texts: list[str] = []
_emb_index_langs: list[str] = []
_emb_index_mat: Optional[np.ndarray] = None  # shape (N, D), float32

def _get_emb_dim() -> int:
    global _emb_dim
    if _emb_dim is not None:
        return _emb_dim
    try:
        model = _get_model()
        dim = int(model.get_sentence_embedding_dimension())
    except Exception:
        # Fallback for common MiniLM embedding dim
        dim = 384
    _emb_dim = dim
    return dim

COLLECTION = "records"

def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default

def _env_str(name: str, default: str) -> str:
    return os.environ.get(name) or default

def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}

DUPLICATE_THRESHOLD = max(0.0, min(1.0, _env_float("DUPLICATE_THRESHOLD", 0.70)))
MODEL_NAME = _env_str("MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")

USE_SQLITE = _env_bool("USE_SQLITE", True)
SQLITE_PATH = os.environ.get(
    "SQLITE_PATH",
    os.path.join(os.path.dirname(__file__), "duplidetect.sqlite"),
)

def _get_sqlite():
    """Persistent local fallback store (useful for hackathons / demos)."""
    global _sqlite
    if not USE_SQLITE:
        return None
    if _sqlite is not None:
        return _sqlite
    try:
        conn = sqlite3.connect(SQLITE_PATH, check_same_thread=False)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
              id TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              language TEXT,
              embedding TEXT
            )
            """
        )
        conn.commit()
        _sqlite = conn
        return _sqlite
    except Exception as exc:
        print(f"[SQLite] Could not initialise: {exc}")
        _sqlite = None
        return None

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

def embed_many(texts: list[str]) -> np.ndarray:
    arr = _get_model().encode(
        [preprocess(t) for t in texts],
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return np.asarray(arr, dtype=np.float32)

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
    threshold: Optional[float] = None

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

class BulkAddRequest(BaseModel):
    texts: list[str]
    threshold: Optional[float] = DUPLICATE_THRESHOLD

class BulkAddResponse(BaseModel):
    total: int
    added: int
    duplicates: int
    failed: int
    results: list[AddRecordResponse]

# ---------------------------------------------------------------------------
# In-memory fallback store when Firebase is unavailable
# ---------------------------------------------------------------------------
_memory_store: dict[str, dict[str, Any]] = {}
_id_counter = 0

def _mark_index_dirty():
    global _emb_index_dirty
    _emb_index_dirty = True

def _refresh_embedding_index():
    global _emb_index_dirty, _emb_index_ids, _emb_index_texts, _emb_index_langs, _emb_index_mat
    records = _all_records()
    ids: list[str] = []
    texts: list[str] = []
    langs: list[str] = []
    embs: list[np.ndarray] = []

    for rec in records:
        rid = rec.get("id")
        text = rec.get("text")
        if not rid or not isinstance(text, str) or not text.strip():
            continue

        emb = rec.get("embedding")
        if emb is None:
            emb_vec = np.asarray(embed(text), dtype=np.float32)
        else:
            emb_vec = np.asarray(emb, dtype=np.float32)

        ids.append(str(rid))
        texts.append(text)
        langs.append(rec.get("language", "unknown"))
        embs.append(emb_vec)

    if embs:
        mat = np.vstack(embs).astype(np.float32)
    else:
        mat = np.zeros((0, _get_emb_dim()), dtype=np.float32)

    _emb_index_ids = ids
    _emb_index_texts = texts
    _emb_index_langs = langs
    _emb_index_mat = mat
    _emb_index_dirty = False

def _get_embedding_index():
    if _emb_index_dirty or _emb_index_mat is None:
        _refresh_embedding_index()
    return _emb_index_ids, _emb_index_texts, _emb_index_langs, _emb_index_mat  # type: ignore[return-value]

def _next_id() -> str:
    global _id_counter
    _id_counter += 1
    return f"mem_{_id_counter}"

def _all_records() -> list[dict[str, Any]]:
    db = _get_db()
    if db:
        docs = db.collection(COLLECTION).stream()
        return [{"id": d.id, **d.to_dict()} for d in docs]

    sql = _get_sqlite()
    if sql:
        import json

        out: list[dict[str, Any]] = []
        rows = sql.execute("SELECT id, text, language, embedding FROM records").fetchall()
        for rid, text, language, embedding_json in rows:
            rec: dict[str, Any] = {"id": rid, "text": text, "language": language or "unknown"}
            if embedding_json:
                try:
                    rec["embedding"] = json.loads(embedding_json)
                except Exception:
                    rec["embedding"] = None
            out.append(rec)
        return out
    return list(_memory_store.values())

def _add_record_store(text: str, language: str, embedding: list[float]) -> str:
    db = _get_db()
    if db:
        doc_ref = db.collection(COLLECTION).document()
        doc_ref.set({"text": text, "language": language, "embedding": embedding})
        return doc_ref.id

    sql = _get_sqlite()
    if sql:
        import json

        rid = str(uuid.uuid4())
        sql.execute(
            "INSERT INTO records (id, text, language, embedding) VALUES (?, ?, ?, ?)",
            (rid, text, language, json.dumps(embedding)),
        )
        sql.commit()
        return rid
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
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "firebase": _get_db() is not None,
        "sqlite": _get_sqlite() is not None,
    }


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
    query_emb = np.asarray(embed(req.query), dtype=np.float32)
    ids, texts, langs, mat = _get_embedding_index()
    results: list[SearchMatch] = []
    if mat is not None and mat.shape[0] > 0:
        sims = (mat @ query_emb).astype(np.float32)
        for i, sim in enumerate(sims.tolist()):
            if sim >= threshold:
                results.append(SearchMatch(
                    id=ids[i],
                    text=texts[i],
                    similarity=round(sim * 100, 2),
                    language=langs[i],
                ))
    results.sort(key=lambda x: x.similarity, reverse=True)
    return SearchResponse(input=req.query, matches=results[:10])


@app.post("/add-record", response_model=AddRecordResponse)
def add_record(req: AddRecordRequest):
    if not req.text.strip():
        raise HTTPException(400, "text must be non-empty")
    lang = _detect_language(preprocess(req.text))
    threshold = req.threshold if req.threshold is not None else DUPLICATE_THRESHOLD
    threshold = max(0.0, min(1.0, threshold))

    emb = np.asarray(embed(req.text), dtype=np.float32)

    # Check for duplicates (vectorized)
    ids, texts, langs, mat = _get_embedding_index()
    top_match: Optional[SearchMatch] = None
    if mat is not None and mat.shape[0] > 0:
        sims = (mat @ emb).astype(np.float32)
        j = int(np.argmax(sims))
        max_sim = float(sims[j])
        if max_sim >= threshold:
            top_match = SearchMatch(
                id=ids[j],
                text=texts[j],
                similarity=round(max_sim * 100, 2),
                language=langs[j],
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
    _mark_index_dirty()
    return AddRecordResponse(id=rid, text=req.text, language=lang, inserted=True)


@app.post("/add-records-bulk", response_model=BulkAddResponse)
def add_records_bulk(req: BulkAddRequest):
    texts_in = [t for t in req.texts if isinstance(t, str) and t.strip()]
    threshold = req.threshold if req.threshold is not None else DUPLICATE_THRESHOLD
    threshold = max(0.0, min(1.0, threshold))

    if not texts_in:
        return BulkAddResponse(total=0, added=0, duplicates=0, failed=0, results=[])

    ids, base_texts, base_langs, base_mat = _get_embedding_index()
    base = base_mat if base_mat is not None else np.zeros((0, _get_emb_dim()), dtype=np.float32)

    embs = embed_many(texts_in)

    results: list[AddRecordResponse] = []
    added = duplicates = failed = 0

    # Detect duplicates within the same upload without copying the full base matrix.
    pending_mat = np.zeros((0, _get_emb_dim()), dtype=np.float32)
    pending_ids: list[str] = []
    pending_texts: list[str] = []
    pending_langs: list[str] = []
    pending_tail: list[np.ndarray] = []

    def flush_tail():
        nonlocal pending_mat, pending_tail
        if not pending_tail:
            return
        tail = np.vstack(pending_tail).astype(np.float32)
        pending_mat = np.vstack([pending_mat, tail]) if pending_mat.shape[0] else tail
        pending_tail = []

    for i, text in enumerate(texts_in):
        try:
            lang = _detect_language(preprocess(text))
            emb = embs[i]

            best_sim = -1.0
            best_id = ""
            best_text = ""
            best_lang = "unknown"

            if base.shape[0] > 0:
                sims = (base @ emb).astype(np.float32)
                j = int(np.argmax(sims))
                best_sim = float(sims[j])
                best_id = ids[j]
                best_text = base_texts[j]
                best_lang = base_langs[j]

            if pending_mat.shape[0] > 0:
                sims2 = (pending_mat @ emb).astype(np.float32)
                j2 = int(np.argmax(sims2))
                sim2 = float(sims2[j2])
                if sim2 > best_sim:
                    best_sim = sim2
                    best_id = pending_ids[j2]
                    best_text = pending_texts[j2]
                    best_lang = pending_langs[j2]

            if pending_tail:
                for k, pe in enumerate(pending_tail):
                    simt = float(np.dot(pe, emb))
                    if simt > best_sim:
                        best_sim = simt
                        idx = len(pending_ids) - len(pending_tail) + k
                        best_id = pending_ids[idx]
                        best_text = pending_texts[idx]
                        best_lang = pending_langs[idx]

            if best_sim >= threshold and best_id:
                duplicates += 1
                top_match = SearchMatch(
                    id=best_id,
                    text=best_text,
                    similarity=round(best_sim * 100, 2),
                    language=best_lang,
                )
                results.append(
                    AddRecordResponse(
                        id="",
                        text=text,
                        language=lang,
                        inserted=False,
                        warning=f"Possible duplicate detected (similarity {top_match.similarity}%)",
                        top_match=top_match,
                    )
                )
                continue

            rid = _add_record_store(text, lang, emb.tolist())
            added += 1
            results.append(AddRecordResponse(id=rid, text=text, language=lang, inserted=True))
            pending_ids.append(rid)
            pending_texts.append(text)
            pending_langs.append(lang)

            pending_tail.append(emb)
            if len(pending_tail) >= 128:
                flush_tail()

        except Exception as exc:
            failed += 1
            results.append(
                AddRecordResponse(
                    id="",
                    text=text,
                    language="unknown",
                    inserted=False,
                    warning=f"Failed to add: {exc}",
                    top_match=None,
                )
            )

    flush_tail()
    if added > 0:
        _mark_index_dirty()

    return BulkAddResponse(
        total=len(texts_in),
        added=added,
        duplicates=duplicates,
        failed=failed,
        results=results,
    )


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
        sql = _get_sqlite()
        if sql:
            sql.execute("DELETE FROM records WHERE id = ?", (record_id,))
            sql.commit()
        else:
            _memory_store.pop(record_id, None)
    _mark_index_dirty()
    return {"deleted": record_id}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
