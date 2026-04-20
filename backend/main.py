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
import io
import csv
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager
import logging
from typing import Any, Optional
from dotenv import load_dotenv

# Load environment variables from .env or .env.local
load_dotenv()  # looks for .env
# Ensure local overrides win over generic .env values.
load_dotenv(".env.local", override=True)  # also load .env.local if it exists
backend_env = os.path.join(os.path.dirname(__file__), ".env.local")
if os.path.exists(backend_env):
    load_dotenv(backend_env, override=True)

from concept import ConceptMatcher, get_concept_score as concept_similarity
from phonetic import get_phonetic_similarity as phonetic_similarity

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Optional imports for PDF/OCR processing
try:
    import requests
except ImportError as e:
    print(f"Warning: requests not available: {e}")
    requests = None

try:
    import pandas as pd
except ImportError as e:
    print(f"Warning: pandas not available: {e}")
    pd = None

try:
    from PIL import Image
except ImportError as e:
    print(f"Warning: pillow not available: {e}")
    Image = None

try:
    import base64
except ImportError as e:
    print(f"Warning: base64 not available: {e}")
    base64 = None

try:
    from pypdf import PdfReader
except ImportError as e:
    print(f"Warning: pypdf not available: {e}")
    PdfReader = None

if PdfReader is None:
    try:
        from PyPDF2 import PdfReader as PyPdf2Reader
        PdfReader = PyPdf2Reader
    except ImportError as e:
        print(f"Warning: PyPDF2 not available: {e}")

try:
    import fitz  # PyMuPDF
except ImportError as e:
    print(f"Warning: pymupdf not available: {e}")
    fitz = None

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError as e:
    print(f"Warning: rapidocr-onnxruntime not available: {e}")
    RapidOCR = None

# Clustering imports
try:
    from sklearn.cluster import DBSCAN
except ImportError:
    print("Warning: scikit-learn not available for clustering")
    DBSCAN = None

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

# Small LRU caches for compare hot path.
_EMBED_CACHE_MAX = int(os.getenv("EMBED_CACHE_MAX", "2000"))
_COMPARE_BRAIN_CACHE_MAX = int(os.getenv("COMPARE_BRAIN_CACHE_MAX", "3000"))
_embed_cache: "OrderedDict[str, np.ndarray]" = OrderedDict()
_compare_brain_cache: "OrderedDict[tuple[str, str], tuple[float, float, float]]" = OrderedDict()
_embed_cache_lock = threading.Lock()
_compare_cache_lock = threading.Lock()
_rapid_ocr_engine = None

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
SEMANTIC_WEIGHT = _env_float("SEMANTIC_WEIGHT", 0.60)
PHONETIC_WEIGHT = _env_float("PHONETIC_WEIGHT", 0.20)
CONCEPT_WEIGHT = _env_float("CONCEPT_WEIGHT", 0.20)
COMPARE_THRESHOLD = _env_float("COMPARE_THRESHOLD", DUPLICATE_THRESHOLD)
TYPO_RATIO_THRESHOLD = max(0.0, min(1.0, _env_float("TYPO_RATIO_THRESHOLD", 0.92)))
LANGUAGE_DIFFERENCE_THRESHOLD = max(0.0, min(1.0, _env_float("LANGUAGE_DIFFERENCE_THRESHOLD", 0.70)))
DEFAULT_W_SEM = float(os.getenv("W_SEM", "0.4"))
DEFAULT_W_PHO = float(os.getenv("W_PHO", "0.3"))
DEFAULT_W_CON = float(os.getenv("W_CON", "0.3"))
DEFAULT_THRESHOLD = float(os.getenv("THRESHOLD", "0.75"))

# NVIDIA API configuration
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY")
NVIDIA_OCR_MODEL = os.environ.get("NVIDIA_OCR_MODEL", "nvidia/nemotron-ocr-v1")
NVIDIA_OCR_BASE_URL = (os.environ.get("NVIDIA_OCR_BASE_URL", "https://integrate.api.nvidia.com") or "").strip().rstrip("/")

def _build_nvidia_ocr_urls(base_url: str) -> tuple[str, str]:
    """
    Build infer/chat URLs while avoiding malformed paths like /v1/v1/infer.
    Accepts either:
    - https://host
    - https://host/v1
    """
    if base_url.endswith("/v1"):
        api_root = base_url
    else:
        api_root = f"{base_url}/v1"
    return f"{api_root}/infer", f"{api_root}/chat/completions"

# Nemotron OCR uses /infer. We keep chat-completions as a compatibility fallback.
NVIDIA_OCR_INFER_URL, NVIDIA_OCR_CHAT_URL = _build_nvidia_ocr_urls(NVIDIA_OCR_BASE_URL)

# Configure basic logging for the backend
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

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
              embedding TEXT,
              item TEXT,
              description TEXT,
              amount TEXT
            )
            """
        )
        # Add new columns if they don't exist (migration)
        try:
            conn.execute("ALTER TABLE records ADD COLUMN item TEXT")
        except:
            pass  # Column might already exist
        try:
            conn.execute("ALTER TABLE records ADD COLUMN description TEXT")
        except:
            pass
        try:
            conn.execute("ALTER TABLE records ADD COLUMN amount TEXT")
        except:
            pass
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
        import time
        from sentence_transformers import SentenceTransformer
        start = time.time()
        logging.info("Loading embedding model: %s", MODEL_NAME)
        _model = SentenceTransformer(MODEL_NAME)
        elapsed = time.time() - start
        logging.info("Model loaded in %.2fs", elapsed)
    return _model

# ---------------------------------------------------------------------------
# Text preprocessing
# ---------------------------------------------------------------------------
def preprocess(text: str) -> str:
    text = text.lower().strip()
    text = unicodedata.normalize("NFKC", text)          # Canonical + compatibility normalization
    # Strip combining marks for Latin-script typo tolerance without altering CJK tokens.
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text)
                   if not unicodedata.combining(ch))
    text = re.sub(r"[\u200b-\u200d\ufeff]", "", text)   # zero-width chars
    text = re.sub(r"\s+", " ", text)
    return text

def _extract_ocr_text_from_response(result: Any) -> str:
    """Best-effort extractor that supports both infer and chat response shapes."""
    if not isinstance(result, dict):
        return ""

    # OpenAI/chat-completions shape
    try:
        chat_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        if isinstance(chat_text, str) and chat_text.strip():
            return chat_text
    except Exception:
        pass

    # Common OCR infer shapes
    for key in ("text", "content", "output_text", "markdown"):
        val = result.get(key)
        if isinstance(val, str) and val.strip():
            return val

    # Walk nested payloads for textual content
    def collect_text(node: Any) -> list[str]:
        out: list[str] = []
        if isinstance(node, str):
            if node.strip():
                out.append(node)
            return out
        if isinstance(node, dict):
            for k, v in node.items():
                if k in {"text", "content", "markdown"} and isinstance(v, str) and v.strip():
                    out.append(v)
                else:
                    out.extend(collect_text(v))
            return out
        if isinstance(node, list):
            for item in node:
                out.extend(collect_text(item))
            return out
        return out

    parts = collect_text(result.get("data", result))
    return "\n".join(p.strip() for p in parts if isinstance(p, str) and p.strip())


def _extract_text_locally(file_content: bytes, filename: str | None = None) -> str:
    """
    Local fallback when remote OCR API is unavailable.
    Currently supports text extraction from PDF files.
    """
    fn = (filename or "").lower()
    if fn.endswith(".pdf") and PdfReader is not None:
        try:
            reader = PdfReader(io.BytesIO(file_content))
            pages: list[str] = []
            for page in reader.pages:
                text = page.extract_text() or ""
                if text.strip():
                    pages.append(text.strip())
            extracted = "\n\n".join(pages).strip()
            if extracted:
                return extracted
        except Exception as exc:
            logging.warning("Local PDF extraction failed: %s", exc)
    # Fall through to OCR fallback for scanned PDFs and image uploads.

    try:
        return _extract_text_with_local_ocr(file_content, filename)
    except Exception as exc:
        logging.warning("Local OCR fallback failed: %s", exc)
        return ""


def _get_rapid_ocr_engine():
    global RapidOCR
    global _rapid_ocr_engine
    if RapidOCR is None:
        try:
            from rapidocr_onnxruntime import RapidOCR as _RapidOCR
            RapidOCR = _RapidOCR
        except Exception as exc:
            logging.warning("RapidOCR import failed at runtime: %s", exc)
            return None
    if RapidOCR is None:
        return None
    if _rapid_ocr_engine is None:
        _rapid_ocr_engine = RapidOCR()
    return _rapid_ocr_engine


def _extract_text_with_local_ocr(file_content: bytes, filename: str | None = None) -> str:
    """
    OCR fallback for scanned PDFs and image uploads using RapidOCR + PyMuPDF.
    """
    engine = _get_rapid_ocr_engine()
    if engine is None:
        return ""

    fn = (filename or "").lower()
    lines: list[str] = []

    def collect_from_image_bytes(img_bytes: bytes):
        result, _ = engine(img_bytes)
        if not result:
            return
        for item in result:
            # item shape: [box, text, score]
            if len(item) >= 2 and isinstance(item[1], str) and item[1].strip():
                lines.append(item[1].strip())

    if fn.endswith(".pdf"):
        global fitz
        if fitz is None:
            try:
                import fitz as _fitz
                fitz = _fitz
            except Exception as exc:
                logging.warning("PyMuPDF import failed at runtime: %s", exc)
                return ""
        if fitz is None:
            return ""
        doc = fitz.open(stream=file_content, filetype="pdf")
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
            collect_from_image_bytes(pix.tobytes("png"))
    else:
        collect_from_image_bytes(file_content)

    return "\n".join(lines).strip()


def _safe_fallback_text(filename: str | None = None) -> str:
    """
    Last-resort text fallback to keep upload flow alive even when OCR is unavailable.
    """
    name = filename or "uploaded_document"
    return (
        f"DOCUMENT_PLACEHOLDER {name}\n"
        "OCR service unavailable and no extractable embedded PDF text found.\n"
        "Please verify NVIDIA OCR access or upload a text-based PDF."
    )


def _is_placeholder_text(text: str) -> bool:
    t = (text or "").strip()
    return t.startswith("DOCUMENT_PLACEHOLDER")


def process_pdf_with_ocr(file_content: bytes, filename: str | None = None) -> str:
    if not requests or not base64:
        local_text = _extract_text_locally(file_content, filename)
        if local_text:
            logging.info("Remote OCR dependencies unavailable; using local PDF extraction fallback")
            return local_text
        logging.warning("OCR dependencies unavailable and local extraction failed; using placeholder text")
        return _safe_fallback_text(filename)

    if not NVIDIA_API_KEY:
        # Mock response for testing when API key is not set
        return "INVOICE #12345\nDate: 2024-1-15\nCustomer: John Doe\n\nItems:\n1. Laptop Computer - $999.99\n2. Wireless Mouse - $29.99\n3. USB Cable - $15.99\n\nSubtotal: $1045.97\nTax: $94.14\nTotal: $1140.11\n\nThank you for your business!"

    try:
        logging.info("Starting OCR for filename=%s size=%d bytes", filename, len(file_content))
        # Convert file content to base64 and prepare payload. Support PDF and images
        b64 = base64.b64encode(file_content).decode('utf-8')
        mime = 'application/pdf'
        if filename:
            fn = filename.lower()
            if fn.endswith('.png'):
                mime = 'image/png'
            elif fn.endswith('.jpg') or fn.endswith('.jpeg'):
                mime = 'image/jpeg'
            elif fn.endswith('.tiff') or fn.endswith('.tif'):
                mime = 'image/tiff'

        data_uri = f"data:{mime};base64,{b64}"

        infer_payload = {
            "model": NVIDIA_OCR_MODEL,
            "input": [
                {
                    "type": "image_url",
                    "url": data_uri,
                }
            ],
        }

        chat_payload = {
            "model": NVIDIA_OCR_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Extract all text from this document. Preserve line breaks and return plain text only.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": data_uri
                            },
                        },
                    ],
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.1,
            "stream": False,
        }

        headers = {
            "Authorization": f"Bearer {NVIDIA_API_KEY}",
            "Content-Type": "application/json"
        }

        # Try OCR infer endpoint first; fallback to chat-completions for compatibility.
        logging.info("Sending request to NVIDIA OCR API via infer endpoint...")
        response = requests.post(NVIDIA_OCR_INFER_URL, json=infer_payload, headers=headers, timeout=60)

        if response.status_code == 404:
            logging.warning("Infer endpoint returned 404, trying chat-completions fallback...")
            response = requests.post(NVIDIA_OCR_CHAT_URL, json=chat_payload, headers=headers, timeout=60)

        if response.status_code != 200:
            logging.error("NVIDIA API error: %d - %s", response.status_code, response.text)
            response.raise_for_status()

        result = response.json()
        extracted_text = _extract_ocr_text_from_response(result)

        if not extracted_text.strip():
            logging.error("OCR response parsed but no text found: %s", result)
            raise HTTPException(500, "OCR response did not contain extractable text")

        logging.info("OCR completed successfully; extracted %d characters", len(extracted_text))

        return extracted_text

    except requests.RequestException as e:
        logging.error("Remote OCR request failed: %s", e)
        local_text = _extract_text_locally(file_content, filename)
        if local_text:
            logging.info("Using local PDF text extraction fallback; extracted %d characters", len(local_text))
            return local_text
        logging.warning("Falling back to safe placeholder text after OCR + local extraction failure")
        return _safe_fallback_text(filename)
    except Exception as e:
        local_text = _extract_text_locally(file_content, filename)
        if local_text:
            logging.info("Using local PDF text extraction fallback after generic OCR error; extracted %d characters", len(local_text))
            return local_text
        logging.warning("Falling back to safe placeholder text after generic OCR error: %s", e)
        return _safe_fallback_text(filename)

def extract_text_to_csv(extracted_text: str) -> str:
    try:
        # Split text into lines
        lines = [line.strip() for line in extracted_text.split('\n') if line.strip()]

        # Create a simple CSV structure
        # For bills, we'll assume a format with columns: Item, Description, Amount
        csv_data = []
        csv_data.append("Item,Description,Amount")

        for i, line in enumerate(lines):
            # Simple parsing - split by common delimiters
            parts = re.split(r'[,\t|]+', line)
            if len(parts) >= 2:
                item = f"Item_{i+1}"
                description = parts[0].strip()
                amount = parts[-1].strip() if len(parts) > 1 else ""
                csv_data.append(f'"{item}","{description}","{amount}"')
            else:
                # Single column entry
                csv_data.append(f'"Item_{i+1}","{line}",""')

        return '\n'.join(csv_data)

    except Exception as e:
        # Fallback: return the raw text as CSV
        return f"Raw_Text\n{extracted_text.replace(',', ';')}"

# ---------------------------------------------------------------------------
# Embedding & similarity
# ---------------------------------------------------------------------------
def embed(text: str) -> np.ndarray:
    key = preprocess(text)
    with _embed_cache_lock:
        cached = _embed_cache.get(key)
        if cached is not None:
            _embed_cache.move_to_end(key)
            return cached

    vec = np.asarray(
        _get_model().encode(key, normalize_embeddings=True),
        dtype=np.float32,
    )
    with _embed_cache_lock:
        _embed_cache[key] = vec
        _embed_cache.move_to_end(key)
        while len(_embed_cache) > _EMBED_CACHE_MAX:
            _embed_cache.popitem(last=False)
    return vec

def embed_many(texts: list[str]) -> np.ndarray:
    arr = _get_model().encode(
        [preprocess(t) for t in texts],
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return np.asarray(arr, dtype=np.float32)


def _brain_cache_key(text1: str, text2: str) -> tuple[str, str]:
    # Similarity is symmetric, so normalize key order.
    p1 = preprocess(text1)
    p2 = preprocess(text2)
    return (p1, p2) if p1 <= p2 else (p2, p1)


def _compute_brain_scores(text1: str, text2: str) -> tuple[float, float, float]:
    key = _brain_cache_key(text1, text2)
    with _compare_cache_lock:
        cached = _compare_brain_cache.get(key)
        if cached is not None:
            _compare_brain_cache.move_to_end(key)
            return cached

    pair_embeddings = embed_many([text1, text2])
    semantic_score = float(cosine_similarity(pair_embeddings[0], pair_embeddings[1]))
    phonetic_score = phonetic_similarity(text1, text2)
    concept_score = app.state.concept_matcher.get_concept_score(text1, text2)

    scores = (
        max(0.0, min(1.0, semantic_score)),
        max(0.0, min(1.0, phonetic_score)),
        max(0.0, min(1.0, concept_score)),
    )

    with _compare_cache_lock:
        _compare_brain_cache[key] = scores
        _compare_brain_cache.move_to_end(key)
        while len(_compare_brain_cache) > _COMPARE_BRAIN_CACHE_MAX:
            _compare_brain_cache.popitem(last=False)
    return scores

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

def _normalize_weights(semantic: float, phonetic: float, concept: float) -> dict[str, float]:
    semantic = max(0.0, semantic)
    phonetic = max(0.0, phonetic)
    concept = max(0.0, concept)
    total = semantic + phonetic + concept
    if total <= 0:
        return {"semantic": 0.60, "phonetic": 0.20, "concept": 0.20}
    return {
        "semantic": semantic / total,
        "phonetic": phonetic / total,
        "concept": concept / total,
    }


def classify_duplicate_type(
    text1: str,
    text2: str,
    semantic_score: float,
    phonetic_score: float,
    concept_score: float,
    combined_score: float,
    threshold: float,
) -> str:
    p1, p2 = preprocess(text1), preprocess(text2)
    lang1, lang2 = _detect_language(p1), _detect_language(p2)
    lev = _levenshtein_ratio(p1, p2)

    if lev >= TYPO_RATIO_THRESHOLD and (lang1 == lang2 or "unknown" in (lang1, lang2)):
        return "typo"
    if semantic_score >= LANGUAGE_DIFFERENCE_THRESHOLD and lang1 != lang2 and lang1 != "unknown" and lang2 != "unknown":
        return "language_difference"

    if combined_score < threshold:
        return "not_duplicate"

    best_type = max(
        [
            ("semantic", semantic_score),
            ("phonetic", phonetic_score),
            ("concept", concept_score),
        ],
        key=lambda item: item[1],
    )
    return best_type[0]

def compute_three_brain_distance(text1: str, text2: str, weights: dict[str, float]) -> float:
    """
    Compute distance between two texts using three-brain system.
    Distance = 1 - weighted_similarity
    Weights are expected to be normalized (sum to 1.0).
    """
    try:
        semantic_score = float(cosine_similarity(embed(text1), embed(text2)))
        phonetic_score = phonetic_similarity(text1, text2)
        concept_score = app.state.concept_matcher.get_concept_score(text1, text2)
        
        # Normalize scores to [0, 1]
        semantic_score = max(0.0, min(1.0, semantic_score))
        phonetic_score = max(0.0, min(1.0, phonetic_score))
        concept_score = max(0.0, min(1.0, concept_score))
        
        # Weighted average similarity
        weighted_similarity = (
            semantic_score * weights.get("semantic", 1/3) +
            phonetic_score * weights.get("phonetic", 1/3) +
            concept_score * weights.get("concept", 1/3)
        )
        
        # Convert to distance (0 = identical, 1 = completely different)
        return 1.0 - weighted_similarity
    except Exception:
        return 1.0  # Maximum distance on error

def compute_distance_matrix(texts: list[str], weights: dict[str, float]) -> np.ndarray:
    """
    Compute pairwise distance matrix for clustering using three-brain system.
    Returns: NxN distance matrix (N = len(texts))
    """
    n = len(texts)
    distance_matrix = np.zeros((n, n), dtype=np.float32)
    
    for i in range(n):
        for j in range(i + 1, n):
            dist = compute_three_brain_distance(texts[i], texts[j], weights)
            distance_matrix[i][j] = dist
            distance_matrix[j][i] = dist  # Symmetric
    
    return distance_matrix

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load Brain 1 model and instantiate Brain 3 concept matcher once at startup.
    logger = logging.getLogger(__name__)
    model = _get_model()
    # Pre-warm the model to avoid first-request latency during demos
    try:
        _ = model.encode(["warmup"], show_progress_bar=False)
        logger.info("Model pre-warmed and ready")
    except Exception as e:
        logger.warning(f"Model pre-warm failed: {e}")
    app.state.concept_matcher = ConceptMatcher()
    print("DupliDetect backend ready: model and ConceptMatcher loaded")
    yield

app = FastAPI(
    title="DupliDetect API",
    lifespan=lifespan,
    description=(
        "Multilingual duplicate detection using sentence-transformers.\n\n"
        "**Core idea**: preprocess → embed → cosine similarity → classify duplicate type.\n\n"
        "**Storage**: Firestore if configured; otherwise SQLite (default) or in-memory fallback.\n\n"
        "**Config (env vars)**:\n"
        "- `MODEL_NAME` (default: `paraphrase-multilingual-MiniLM-L12-v2`)\n"
        "- `DUPLICATE_THRESHOLD` (default: `0.70`, range `0..1`)\n"
        "- `USE_SQLITE` (default: `true`)\n"
        "- `SQLITE_PATH` (default: `backend/duplidetect.sqlite`)\n"
    ),
    version="1.0.0",
    openapi_tags=[
        {"name": "Ops", "description": "Health checks and operational endpoints."},
        {"name": "Core", "description": "Similarity, search, and duplicate detection."},
        {"name": "Records", "description": "CRUD operations for stored records."},
    ],
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
    text1: str = Field(..., description="First input text.", examples=["Login issue"])
    text2: str = Field(..., description="Second input text.", examples=["ログインの問題"])
    weights: Optional[dict] = Field(
        default=None,
        description="Optional weights for semantic, phonetic, and concept scores.",
        examples=[{"semantic": 0.4, "phonetic": 0.3, "concept": 0.3}],
    )
    threshold: Optional[float] = Field(
        default=None,
        description="Optional final duplicate threshold (0..1).",
        examples=[0.75],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"text1": "Login issue", "text2": "ログインの問題"},
                {"text1": "Payment failed", "text2": "الدفع فشل"},
            ]
        }
    }

class CompareResponse(BaseModel):
    text1: str
    text2: str
    semantic_score: float
    phonetic_score: float
    concept_score: float
    combined_score: float
    similarity_score: float          # combined score 0-100 for backwards compatibility
    threshold: float
    weights: dict[str, float]
    is_duplicate: bool
    duplicate_type: str
    lang1: str
    lang2: str

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "text1": "Login issue",
                    "text2": "ログインの問題",
                    "semantic_score": 94.0,
                    "phonetic_score": 68.0,
                    "concept_score": 82.0,
                    "combined_score": 86.0,
                    "similarity_score": 86.0,
                    "threshold": 70.0,
                    "weights": {"semantic": 0.6, "phonetic": 0.2, "concept": 0.2},
                    "is_duplicate": True,
                    "duplicate_type": "language_difference",
                    "lang1": "en",
                    "lang2": "ja",
                }
            ]
        }
    }

class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query text.", examples=["Login problem"])
    threshold: Optional[float] = Field(
        default=DUPLICATE_THRESHOLD,
        description="Similarity threshold as a ratio (0..1).",
        examples=[0.7],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"query": "Login problem", "threshold": 0.7},
                {"query": "Cannot sign in", "threshold": 0.65},
            ]
        }
    }

class SearchMatch(BaseModel):
    id: str
    text: str
    similarity: float
    language: str

class SearchResponse(BaseModel):
    input: str
    matches: list[SearchMatch]

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "input": "Login problem",
                    "matches": [
                        {"id": "abc1", "text": "Login issue", "similarity": 88.3, "language": "en"},
                        {"id": "abc2", "text": "Cannot log in", "similarity": 81.4, "language": "en"},
                    ],
                }
            ]
        }
    }

class AddRecordRequest(BaseModel):
    text: str = Field(..., description="Text to insert.", examples=["Login issue"])
    threshold: Optional[float] = Field(
        default=None,
        description="Optional duplicate threshold override (0..1). If omitted, uses server default.",
        examples=[0.7],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"text": "Login issue", "threshold": 0.7},
                {"text": "ログインの問題"},
            ]
        }
    }

class AddRecordResponse(BaseModel):
    id: str
    text: str
    language: str
    inserted: bool
    warning: Optional[str] = None
    top_match: Optional[SearchMatch] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "id": "new_id",
                    "text": "Login issue",
                    "language": "en",
                    "inserted": True,
                    "warning": None,
                    "top_match": None,
                },
                {
                    "id": "",
                    "text": "Login issue",
                    "language": "en",
                    "inserted": False,
                    "warning": "Possible duplicate detected (similarity 91.2%)",
                    "top_match": {"id": "abc1", "text": "Cannot log in", "similarity": 91.2, "language": "en"},
                },
            ]
        }
    }

class Record(BaseModel):
    id: str
    text: str
    language: str
    item: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[str] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"id": "abc1", "text": "Login issue", "language": "en"},
                {"id": "pdf1", "text": "Laptop Computer $999.99", "language": "en", "item": "Item_1", "description": "Laptop Computer", "amount": "$999.99"}
            ]
        }
    }

class BulkRecordItem(BaseModel):
    text: str
    item: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[str] = None
    language: Optional[str] = None

class BulkAddRequest(BaseModel):
    texts: Optional[list[str]] = Field(
        default=None, description="List of texts to insert.", examples=[["Login issue", "Cannot log in", "ログインの問題"]]
    )
    records: Optional[list[BulkRecordItem]] = Field(
        default=None, description="List of rich records to insert."
    )
    threshold: Optional[float] = Field(
        default=DUPLICATE_THRESHOLD,
        description="Duplicate threshold as ratio (0..1).",
        examples=[0.7],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"texts": ["Login issue", "Cannot log in", "ログインの問題"], "threshold": 0.7}
            ]
        }
    }

class BulkAddResponse(BaseModel):
    total: int
    added: int
    duplicates: int
    failed: int
    results: list[AddRecordResponse]

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "total": 3,
                    "added": 2,
                    "duplicates": 1,
                    "failed": 0,
                    "results": [
                        {"id": "id1", "text": "Login issue", "language": "en", "inserted": True, "warning": None, "top_match": None},
                        {
                            "id": "",
                            "text": "Cannot log in",
                            "language": "en",
                            "inserted": False,
                            "warning": "Possible duplicate detected (similarity 91.2%)",
                            "top_match": {"id": "id1", "text": "Login issue", "similarity": 91.2, "language": "en"},
                        },
                        {"id": "id2", "text": "ログインの問題", "language": "ja", "inserted": True, "warning": None, "top_match": None},
                    ],
                }
            ]
        }
    }

class PDFProcessRequest(BaseModel):
    deduplicate: bool = Field(default=True, description="Whether to deduplicate extracted records")
    threshold: Optional[float] = Field(
        default=DUPLICATE_THRESHOLD,
        description="Similarity threshold for deduplication (0..1)",
        examples=[0.7],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"deduplicate": True, "threshold": 0.7}
            ]
        }
    }

class PDFProcessResponse(BaseModel):
    filename: str
    extracted_text: str
    csv_data: str
    processed_records: int
    duplicates_found: int
    records_added: int
    results: list[AddRecordResponse]

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "filename": "bill.pdf",
                    "extracted_text": "Invoice #12345\nItem: Laptop\nAmount: $999.99",
                    "csv_data": "Item,Description,Amount\n\"Item_1\",\"Invoice #12345\",\"\"\n\"Item_2\",\"Item: Laptop\",\"$999.99\"",
                    "processed_records": 2,
                    "duplicates_found": 0,
                    "records_added": 2,
                    "results": [
                        {"id": "rec1", "text": "Invoice #12345", "language": "en", "inserted": True, "warning": None, "top_match": None},
                        {"id": "rec2", "text": "Item: Laptop Amount: $999.99", "language": "en", "inserted": True, "warning": None, "top_match": None}
                    ]
                }
            ]
        }
    }

class ClusterItem(BaseModel):
    id: str
    text: str
    language: str
    group_id: int
    distance_to_centroid: float

class ClusterGroup(BaseModel):
    group_id: int
    size: int
    confidence: float
    languages: list[str]
    items: list[ClusterItem]
    dominant_match_reason: str

class ClusterRequest(BaseModel):
    texts: list[str] = Field(..., description="List of texts to cluster", examples=[["text1", "text2", "text3"]])
    eps: Optional[float] = Field(
        default=0.25,
        description="DBSCAN epsilon parameter (0..1). Higher = larger clusters.",
        examples=[0.25],
    )
    min_samples: Optional[int] = Field(
        default=1,
        description="DBSCAN min_samples parameter. Minimum points to form a cluster.",
        examples=[1],
    )
    weights: Optional[dict] = Field(
        default=None,
        description="Optional weights for semantic, phonetic, and concept scores.",
        examples=[{"semantic": 0.4, "phonetic": 0.3, "concept": 0.3}],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "texts": ["Login issue", "ログインの問題", "Cannot log in", "Payment failed"],
                    "eps": 0.25,
                    "min_samples": 1,
                    "weights": {"semantic": 0.4, "phonetic": 0.3, "concept": 0.3}
                }
            ]
        }
    }

class ClusterResponse(BaseModel):
    total_texts: int
    num_clusters: int
    num_noise_points: int
    groups: list[ClusterGroup]
    eps: float
    weights: dict[str, float]

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "total_texts": 4,
                    "num_clusters": 2,
                    "num_noise_points": 0,
                    "eps": 0.25,
                    "weights": {"semantic": 0.4, "phonetic": 0.3, "concept": 0.3},
                    "groups": [
                        {
                            "group_id": 0,
                            "size": 3,
                            "confidence": 0.92,
                            "languages": ["en", "ja"],
                            "items": [
                                {"id": "0", "text": "Login issue", "language": "en", "group_id": 0, "distance_to_centroid": 0.12},
                                {"id": "1", "text": "ログインの問題", "language": "ja", "group_id": 0, "distance_to_centroid": 0.18}
                            ],
                            "dominant_match_reason": "High semantic similarity"
                        }
                    ]
                }
            ]
        }
    }

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
        rows = sql.execute("SELECT id, text, language, embedding, item, description, amount FROM records").fetchall()
        for rid, text, language, embedding_json, item, description, amount in rows:
            rec: dict[str, Any] = {"id": rid, "text": text, "language": language or "unknown"}
            if item is not None:
                rec["item"] = item
            if description is not None:
                rec["description"] = description
            if amount is not None:
                rec["amount"] = amount
            if embedding_json:
                try:
                    rec["embedding"] = json.loads(embedding_json)
                except Exception:
                    rec["embedding"] = None
            out.append(rec)
        return out
    return list(_memory_store.values())

def _add_record_store(text: str, language: str, embedding: list[float], item: Optional[str] = None, description: Optional[str] = None, amount: Optional[str] = None) -> str:
    db = _get_db()
    if db:
        doc_ref = db.collection(COLLECTION).document()
        data = {"text": text, "language": language, "embedding": embedding}
        if item is not None:
            data["item"] = item
        if description is not None:
            data["description"] = description
        if amount is not None:
            data["amount"] = amount
        doc_ref.set(data)
        return doc_ref.id

    sql = _get_sqlite()
    if sql:
        import json

        rid = str(uuid.uuid4())
        sql.execute(
            "INSERT INTO records (id, text, language, embedding, item, description, amount) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (rid, text, language, json.dumps(embedding), item, description, amount),
        )
        sql.commit()
        return rid
    rid = _next_id()
    data = {"id": rid, "text": text, "language": language, "embedding": embedding}
    if item is not None:
        data["item"] = item
    if description is not None:
        data["description"] = description
    if amount is not None:
        data["amount"] = amount
    _memory_store[rid] = data
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


@app.post(
    "/compare",
    response_model=dict,
    tags=["Core"],
    summary="Compare two texts",
    description=(
        "Returns multi-brain scores and a final duplicate verdict. "
        "Weights and threshold can be configured via environment variables or request payload."
    ),
)
def compare(req: CompareRequest):
    try:
        if not req.text1.strip() or not req.text2.strip():
            raise HTTPException(400, "Both text1 and text2 must be non-empty")

        raw_weights = req.weights or {}
        w_sem = float(raw_weights.get("semantic", DEFAULT_W_SEM))
        w_pho = float(raw_weights.get("phonetic", DEFAULT_W_PHO))
        w_con = float(raw_weights.get("concept", DEFAULT_W_CON))

        weights = {
            "semantic": max(0.0, w_sem),
            "phonetic": max(0.0, w_pho),
            "concept": max(0.0, w_con),
        }

        if any(value == 0.0 for value in weights.values()):
            nonzero = {k: v for k, v in weights.items() if v > 0.0}
            if nonzero:
                total = sum(nonzero.values())
                weights = {
                    key: (value / total if value > 0 else 0.0)
                    for key, value in weights.items()
                }
            else:
                weights = {"semantic": 1 / 3, "phonetic": 1 / 3, "concept": 1 / 3}
        else:
            total = sum(weights.values())
            if total <= 0:
                weights = {"semantic": 1 / 3, "phonetic": 1 / 3, "concept": 1 / 3}
            else:
                weights = {k: v / total for k, v in weights.items()}

        threshold = req.threshold if req.threshold is not None else DEFAULT_THRESHOLD
        threshold = max(0.0, min(1.0, float(threshold)))

        semantic_score, phonetic_score, concept_score = _compute_brain_scores(req.text1, req.text2)

        final_score = (
            semantic_score * weights["semantic"]
            + phonetic_score * weights["phonetic"]
            + concept_score * weights["concept"]
        )

        is_duplicate = final_score >= threshold
        override_reason = ""
        # Strong Brain 3 match should not be suppressed by strict weighted thresholding.
        if not is_duplicate and concept_score >= 0.8:
            is_duplicate = True
            override_reason = "concept_override"
        # High semantic + non-trivial phonetic support usually indicates same record phrasing.
        elif not is_duplicate and semantic_score >= 0.9 and phonetic_score >= 0.45:
            is_duplicate = True
            override_reason = "semantic_override"

        explanation_parts: list[str] = []
        if concept_score == 1.0:
            explanation_parts.append("Same concept detected")
        if phonetic_score > 0.8:
            explanation_parts.append("High phonetic similarity")
        if semantic_score > 0.8:
            explanation_parts.append("High semantic similarity")
        if final_score < threshold and not is_duplicate:
            explanation_parts.append("Combined score below threshold")
        if override_reason == "concept_override":
            explanation_parts.append("Duplicate promoted by strong concept match")
        elif override_reason == "semantic_override":
            explanation_parts.append("Duplicate promoted by strong semantic match")
        explanation = " and ".join(explanation_parts) or "Comparison completed"

        return {
            "is_duplicate": is_duplicate,
            "semantic_score": round(semantic_score, 4),
            "phonetic_score": round(phonetic_score, 4),
            "concept_score": concept_score,
            "final_score": round(final_score, 4),
            "decision_mode": override_reason or "weighted",
            "explanation": explanation,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post(
    "/cluster",
    response_model=ClusterResponse,
    tags=["Core"],
    summary="Cluster texts using multi-brain distance",
    description=(
        "Cluster texts using DBSCAN with three-brain pairwise distance matrix. "
        "Returns cluster groups with confidence and match reasons."
    ),
)
def cluster(req: ClusterRequest):
    try:
        if not req.texts or len(req.texts) < 2:
            raise HTTPException(400, "At least 2 texts required for clustering")
        
        # Validate and prepare texts
        texts = [t.strip() for t in req.texts if isinstance(t, str) and t.strip()]
        if len(texts) < 2:
            raise HTTPException(400, "At least 2 non-empty texts required for clustering")
        
        # Normalize weights
        raw_weights = req.weights or {}
        w_sem = float(raw_weights.get("semantic", DEFAULT_W_SEM))
        w_pho = float(raw_weights.get("phonetic", DEFAULT_W_PHO))
        w_con = float(raw_weights.get("concept", DEFAULT_W_CON))
        
        weights = {
            "semantic": max(0.0, w_sem),
            "phonetic": max(0.0, w_pho),
            "concept": max(0.0, w_con),
        }
        
        if any(value == 0.0 for value in weights.values()):
            nonzero = {k: v for k, v in weights.items() if v > 0.0}
            if nonzero:
                total = sum(nonzero.values())
                weights = {
                    key: (value / total if value > 0 else 0.0)
                    for key, value in weights.items()
                }
            else:
                weights = {"semantic": 1 / 3, "phonetic": 1 / 3, "concept": 1 / 3}
        else:
            total = sum(weights.values())
            if total <= 0:
                weights = {"semantic": 1 / 3, "phonetic": 1 / 3, "concept": 1 / 3}
            else:
                weights = {k: v / total for k, v in weights.items()}
        
        # Validate eps and min_samples
        eps = max(0.01, min(1.0, req.eps or 0.25))
        min_samples = max(1, req.min_samples or 1)
        
        if DBSCAN is None:
            raise HTTPException(500, "scikit-learn not installed. Install with: pip install scikit-learn")
        
        # Compute distance matrix
        distance_matrix = compute_distance_matrix(texts, weights)
        
        # Run DBSCAN
        clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='precomputed')
        labels = clustering.fit_predict(distance_matrix)
        
        # Organize results by cluster
        unique_labels = set(labels)
        groups_dict: dict[int, list[int]] = {}
        for idx, label in enumerate(labels):
            if label not in groups_dict:
                groups_dict[label] = []
            groups_dict[label].append(idx)
        
        # Build response groups
        groups: list[ClusterGroup] = []
        noise_count = 0
        
        for group_id in sorted(unique_labels):
            indices = groups_dict[group_id]
            
            if group_id == -1:  # DBSCAN noise points
                noise_count = len(indices)
                continue
            
            # Get texts and languages
            group_texts = [texts[i] for i in indices]
            group_langs = list(set(_detect_language(preprocess(t)) for t in group_texts))
            
            # Compute cluster metrics
            cluster_distances = []
            centroid_distances = []
            
            for i in indices:
                for j in indices:
                    if i < j:
                        cluster_distances.append(float(distance_matrix[i][j]))
            
            # Average distance within cluster (confidence = 1 - avg_distance)
            avg_distance = np.mean(cluster_distances) if cluster_distances else 0.0
            confidence = max(0.0, 1.0 - avg_distance)
            
            # Determine dominant match reason
            match_reason = "Similar content"
            if len(group_texts) >= 2:
                # Analyze first two texts in cluster
                sem_score = float(cosine_similarity(embed(group_texts[0]), embed(group_texts[1])))
                pho_score = phonetic_similarity(group_texts[0], group_texts[1])
                con_score = app.state.concept_matcher.get_concept_score(group_texts[0], group_texts[1])
                
                if con_score == 1.0:
                    match_reason = "Concept match"
                elif pho_score > 0.8:
                    match_reason = "High phonetic similarity"
                elif sem_score > 0.8:
                    match_reason = "High semantic similarity"
                else:
                    match_reason = "Clustered similarity"
            
            # Build cluster items
            items: list[ClusterItem] = []
            for idx, text_idx in enumerate(indices):
                items.append(ClusterItem(
                    id=str(text_idx),
                    text=texts[text_idx],
                    language=_detect_language(preprocess(texts[text_idx])),
                    group_id=int(group_id),
                    distance_to_centroid=float(np.mean([distance_matrix[text_idx][other_idx] for other_idx in indices if other_idx != text_idx])) if len(indices) > 1 else 0.0
                ))
            
            groups.append(ClusterGroup(
                group_id=int(group_id),
                size=len(indices),
                confidence=round(confidence, 4),
                languages=sorted(group_langs),
                items=items,
                dominant_match_reason=match_reason
            ))
        
        return ClusterResponse(
            total_texts=len(texts),
            num_clusters=len(groups),
            num_noise_points=noise_count,
            groups=groups,
            eps=eps,
            weights=weights,
        )
    
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post(
    "/search",
    response_model=SearchResponse,
    tags=["Core"],
    summary="Search similar records",
    description="Find top similar stored records above the given threshold.",
)
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


@app.post(
    "/add-record",
    response_model=AddRecordResponse,
    tags=["Records"],
    summary="Insert a record (with duplicate warning)",
    description=(
        "Checks for a probable duplicate before inserting. If a match above the threshold exists, "
        "returns `inserted=false` with a warning and `top_match`."
    ),
)
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


@app.post(
    "/add-records-bulk",
    response_model=BulkAddResponse,
    tags=["Records"],
    summary="Bulk insert records",
    description=(
        "Bulk insert with duplicate detection against existing records and within the same upload. "
        "Returns per-item results and summary counts (added/duplicates/failed)."
    ),
)
def add_records_bulk(req: BulkAddRequest):
    records_in = []
    if req.records:
        records_in = [r for r in req.records if r.text.strip()]
    elif req.texts:
        records_in = [BulkRecordItem(text=t) for t in req.texts if isinstance(t, str) and t.strip()]
    
    threshold = req.threshold if req.threshold is not None else DUPLICATE_THRESHOLD
    threshold = max(0.0, min(1.0, threshold))

    if not records_in:
        return BulkAddResponse(total=0, added=0, duplicates=0, failed=0, results=[])

    ids, base_texts, base_langs, base_mat = _get_embedding_index()
    base = base_mat if base_mat is not None else np.zeros((0, _get_emb_dim()), dtype=np.float32)

    embs = embed_many([r.text for r in records_in])

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

    for i, rec in enumerate(records_in):
        text = rec.text
        try:
            lang = _detect_language(preprocess(text))
            if rec.language:
                lang = rec.language
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

            rid = _add_record_store(text, lang, emb.tolist(), item=rec.item, description=rec.description, amount=rec.amount)
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
        total=len(records_in),
        added=added,
        duplicates=duplicates,
        failed=failed,
        results=results,
    )


@app.post(
    "/process-pdf",
    response_model=PDFProcessResponse,
    tags=["OCR"],
    summary="Process PDF with OCR and deduplication",
    description="Upload a PDF file, extract text using NVIDIA Nemotron-OCR-v1, convert to CSV, and optionally deduplicate against existing records.",
)
async def process_pdf(
    file: UploadFile = File(...),
    deduplicate: bool = True,
    threshold: Optional[float] = None
):
    # Accept PDF and common image formats (jpg, jpeg, png, tiff)
    fname = file.filename.lower()
    if not (fname.endswith('.pdf') or fname.endswith('.png') or fname.endswith('.jpg') or fname.endswith('.jpeg') or fname.endswith('.tiff') or fname.endswith('.tif')):
        raise HTTPException(400, "Only PDF and image files (png/jpg/tiff) are supported")

    # Read file content
    file_content = await file.read()

    if len(file_content) == 0:
        raise HTTPException(400, "Empty file")

    if len(file_content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(400, "File too large (max 10MB)")

    try:
        logging.info("Processing upload: filename=%s size=%d bytes deduplicate=%s threshold=%s", file.filename, len(file_content), deduplicate, threshold)
        # Process file with OCR (PDF or image)
        extracted_text = process_pdf_with_ocr(file_content, file.filename)

        # If OCR is unavailable and we returned fallback placeholder text,
        # do not ingest synthetic lines into dedup/storage.
        if _is_placeholder_text(extracted_text):
            logging.warning("OCR placeholder text detected; skipping CSV parse and record insertion")
            return PDFProcessResponse(
                filename=file.filename,
                extracted_text=extracted_text,
                csv_data="Item,Description,Amount\n",
                processed_records=0,
                duplicates_found=0,
                records_added=0,
                results=[]
            )

        # Convert to CSV
        csv_data = extract_text_to_csv(extracted_text)
        logging.info("Converted extracted text to CSV; csv length=%d bytes", len(csv_data))

        # Parse CSV and prepare records for deduplication
        csv_lines = csv_data.split('\n')
        if len(csv_lines) < 2:
            raise HTTPException(500, "No valid data extracted from PDF")

        # Skip header and process data rows
        data_rows = csv_lines[1:]
        records_to_process = []

        for row in data_rows:
            if row.strip():
                # Parse CSV row
                parts = row.split(',')
                if len(parts) >= 2:
                    item = parts[0].strip('"')
                    desc = parts[1].strip('"')
                    amt = parts[2].strip('"') if len(parts) > 2 else ''
                    text = f"{desc} {amt}".strip()
                    if text:
                        records_to_process.append({
                            'item': item,
                            'description': desc,
                            'amount': amt,
                            'text': text
                        })

        if not records_to_process:
            logging.warning("No records parsed from CSV data; returning empty processing result")
            return PDFProcessResponse(
                filename=file.filename,
                extracted_text=extracted_text,
                csv_data=csv_data,
                processed_records=0,
                duplicates_found=0,
                records_added=0,
                results=[]
            )

        # Process with deduplication if requested
        results = []
        processed_records = 0
        duplicates_found = 0
        records_added = 0

        if deduplicate:
            # Use bulk add with deduplication to speed up embedding (batch encode)
            bulk_threshold = threshold if threshold is not None else DUPLICATE_THRESHOLD
            texts = [r['text'] for r in records_to_process]
            logging.info("Dedup bulk add for %d records (threshold=%s)", len(texts), bulk_threshold)
            try:
                bulk_resp = add_records_bulk_sync(texts, bulk_threshold)
                results = bulk_resp.results
                processed_records = bulk_resp.total
                records_added = bulk_resp.added
                duplicates_found = bulk_resp.duplicates
            except Exception as e:
                logging.error("Bulk add failed: %s", str(e))
                # Fallback to per-record processing
                for record in records_to_process:
                    try:
                        response = add_record_sync(record['text'], bulk_threshold, record['item'], record['description'], record['amount'])
                        results.append(response)
                        processed_records += 1
                        if response.inserted:
                            records_added += 1
                        else:
                            duplicates_found += 1
                    except Exception as e2:
                        results.append(AddRecordResponse(
                            id="",
                            text=record['text'],
                            language="unknown",
                            inserted=False,
                            warning=f"Failed to add: {str(e2)}",
                            top_match=None,
                        ))
        else:
            # Add all records without deduplication
            for record in records_to_process:
                try:
                    response = add_record_sync(record['text'], None, record['item'], record['description'], record['amount'])
                    results.append(response)
                    processed_records += 1
                    if response.inserted:
                        records_added += 1
                except Exception as e:
                    results.append(AddRecordResponse(
                        id="",
                        text=record['text'],
                        language="unknown",
                        inserted=False,
                        warning=f"Failed to add: {str(e)}",
                        top_match=None,
                    ))

        return PDFProcessResponse(
            filename=file.filename,
            extracted_text=extracted_text,
            csv_data=csv_data,
            processed_records=processed_records,
            duplicates_found=duplicates_found,
            records_added=records_added,
            results=results
        )

    except Exception as e:
        logging.exception("process_pdf failed unexpectedly: %s", e)
        return PDFProcessResponse(
            filename=file.filename,
            extracted_text=_safe_fallback_text(file.filename),
            csv_data="Item,Description,Amount\n",
            processed_records=0,
            duplicates_found=0,
            records_added=0,
            results=[]
        )


def add_record_sync(text: str, threshold: Optional[float] = None, item: Optional[str] = None, description: Optional[str] = None, amount: Optional[str] = None) -> AddRecordResponse:
    if not text.strip():
        raise ValueError("text must be non-empty")
    logger = logging.getLogger(__name__)
    logger.info("add_record_sync: starting for item=%s text_len=%d", item or "-", len(text))
    lang = _detect_language(preprocess(text))
    threshold_val = threshold if threshold is not None else DUPLICATE_THRESHOLD
    threshold_val = max(0.0, min(1.0, threshold_val))

    emb = np.asarray(embed(text), dtype=np.float32)

    # Check for duplicates
    ids, texts, langs, mat = _get_embedding_index()
    top_match: Optional[SearchMatch] = None
    if mat is not None and mat.shape[0] > 0:
        sims = (mat @ emb).astype(np.float32)
        j = int(np.argmax(sims))
        max_sim = float(sims[j])
        if max_sim >= threshold_val:
            top_match = SearchMatch(
                id=ids[j],
                text=texts[j],
                similarity=round(max_sim * 100, 2),
                language=langs[j],
            )

    if top_match:
        logger.info("add_record_sync: duplicate found (sim=%s) for item=%s", top_match.similarity, item or "-")
        return AddRecordResponse(
            id="",
            text=text,
            language=lang,
            inserted=False,
            warning=f"Possible duplicate detected (similarity {top_match.similarity}%)",
            top_match=top_match,
        )

    rid = _add_record_store(text, lang, emb.tolist(), item, description, amount)
    _mark_index_dirty()
    logger.info("add_record_sync: inserted id=%s for item=%s", rid, item or "-")
    return AddRecordResponse(id=rid, text=text, language=lang, inserted=True)


def add_records_bulk_sync(texts: list[str], threshold: Optional[float] = None) -> BulkAddResponse:
    texts_in = [t for t in texts if isinstance(t, str) and t.strip()]
    threshold_val = threshold if threshold is not None else DUPLICATE_THRESHOLD
    threshold_val = max(0.0, min(1.0, threshold_val))

    if not texts_in:
        return BulkAddResponse(total=0, added=0, duplicates=0, failed=0, results=[])

    ids, base_texts, base_langs, base_mat = _get_embedding_index()
    base = base_mat if base_mat is not None else np.zeros((0, _get_emb_dim()), dtype=np.float32)

    logger = logging.getLogger(__name__)
    logger.info("add_records_bulk_sync: encoding %d texts (threshold=%s)", len(texts_in), threshold_val)
    embs = embed_many(texts_in)
    logger.info("add_records_bulk_sync: encoding done; emb shape=%s", getattr(embs, 'shape', 'unknown'))

    results: list[AddRecordResponse] = []
    added = duplicates = failed = 0

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

            if best_sim >= threshold_val and best_id:
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
                logger.info("bulk: record %d duplicate (sim=%s) id=%s", i + 1, top_match.similarity, top_match.id)
                continue

            rid = _add_record_store(text, lang, emb.tolist())
            added += 1
            results.append(AddRecordResponse(id=rid, text=text, language=lang, inserted=True))
            logger.info("bulk: record %d added id=%s", i + 1, rid)

        except Exception as exc:
            failed += 1
            logger.exception("add_records_bulk_sync: failed to add record %d: %s", i + 1, exc)
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

    if added > 0:
        _mark_index_dirty()

    logger.info("add_records_bulk_sync: finished total=%d added=%d duplicates=%d failed=%d", len(texts_in), added, duplicates, failed)

    return BulkAddResponse(
        total=len(texts_in),
        added=added,
        duplicates=duplicates,
        failed=failed,
        results=results,
    )


@app.get(
    "/demo-data",
    tags=["Ops"],
    summary="Get demo dataset",
    description="Returns sample multilingual texts for testing and demonstration.",
)
def get_demo_data():
    """Return demo data CSV that can be used for testing clustering."""
    demo_texts = [
        "Login issue",
        "ログインの問題",
        "Cannot log in",
        "登录问题",
        "Payment failed",
        "الدفع فشل",
        "Payment error",
        "支払いエラー",
        "Billing problem",
        "Reset password",
        "パスワードをリセット",
        "Resetear contraseña",
        "Oubli du mot de passe",
        "Two factor authentication",
        "二要素認証",
        "Database connection error",
        "データベース接続エラー",
        "ডাটাবেস সংযোগ ত্রুটি",
        "Koneksi database gagal",
        "Apple Inc",
        "Apple",
        "りんご",
        "Microsoft Corporation",
        "Google",
        "Coca-Cola",
        "コカ・コーラ",
        "可口可乐",
        "Tokyo",
        "東京",
        "New York",
        "Paris",
        "パリ",
        "USA",
        "United States",
        "Japan",
        "日本",
        "France",
        "フランス",
        "Account locked",
        "アカウントがロックされている",
        "Server timeout",
        "サーバータイムアウト",
        "Timeout error",
        "Connection refused",
        "接続が拒否されました",
        "API error",
        "APIエラー",
        "Authentication failed",
        "認証に失敗しました",
        "Unauthorized access",
    ]
    return {
        "count": len(demo_texts),
        "texts": demo_texts,
        "description": "Sample multilingual texts for testing clustering and duplication detection"
    }


@app.post(
    "/load-demo-data",
    response_model=BulkAddResponse,
    tags=["Records"],
    summary="Load demo dataset into database",
    description="Loads sample multilingual texts into the record store for testing.",
)
def load_demo_data():
    """Load demo dataset and add to records."""
    demo_texts = [
        "Login issue",
        "ログインの問題",
        "Cannot log in",
        "登录问题",
        "Payment failed",
        "الدفع فشل",
        "Payment error",
        "支払いエラー",
        "Billing problem",
        "Reset password",
        "パスワードをリセット",
        "Resetear contraseña",
        "Oubli du mot de passe",
        "Two factor authentication",
        "二要素認証",
        "Database connection error",
        "データベース接続エラー",
        "ডাটাবেস সংযোগ ত্রুটি",
        "Koneksi database gagal",
        "Apple Inc",
        "Apple",
        "りんご",
        "Microsoft Corporation",
        "Google",
        "Coca-Cola",
        "コカ・コーラ",
        "可口可乐",
        "Tokyo",
        "東京",
        "New York",
        "Paris",
        "パリ",
        "USA",
        "United States",
        "Japan",
        "日本",
        "France",
        "フランス",
        "Account locked",
        "アカウントがロックされている",
        "Server timeout",
        "サーバータイムアウト",
        "Timeout error",
        "Connection refused",
        "接続が拒否されました",
        "API error",
        "APIエラー",
        "Authentication failed",
        "認証に失敗しました",
        "Unauthorized access",
    ]
    
    return add_records_bulk_sync(demo_texts, DUPLICATE_THRESHOLD)


@app.delete(
    "/records",
    tags=["Records"],
    summary="Clear all records",
    description="Delete all stored records (useful for resetting during testing).",
)
def clear_all_records():
    """Clear all records from the database."""
    db = _get_db()
    if db:
        docs = db.collection(COLLECTION).stream()
        for doc in docs:
            doc.reference.delete()
    else:
        sql = _get_sqlite()
        if sql:
            sql.execute("DELETE FROM records")
            sql.commit()
        else:
            _memory_store.clear()
    
    _mark_index_dirty()
    return {"deleted": "all records", "status": "success"}


@app.get(
    "/report",
    tags=["Records"],
    summary="Generate summary report",
    description="Generate a text-based summary report of all records and clustering analysis.",
)
def generate_report():
    """Generate a summary report of stored records."""
    records = _all_records()
    
    if not records:
        return {
            "title": "DupliDetect Summary Report",
            "timestamp": str(os.sys.datetime.now() if hasattr(os, 'sys') else ""),
            "total_records": 0,
            "unique_languages": [],
            "content": "No records in database."
        }
    
    import datetime
    
    # Compute statistics
    langs = {}
    for rec in records:
        lang = rec.get("language", "unknown")
        langs[lang] = langs.get(lang, 0) + 1
    
    # Group by similarity (simple approach)
    groups = {}
    for idx, rec in enumerate(records):
        if idx == 0:
            groups[0] = [idx]
        else:
            # Compare with existing groups (simple clustering)
            best_sim = -1.0
            best_group = 0
            for g_id, g_indices in groups.items():
                if g_id == -1:
                    continue
                ref_idx = g_indices[0]
                sim = cosine_similarity(embed(records[idx]["text"]), embed(records[ref_idx]["text"]))
                if sim > best_sim and sim >= 0.7:  # Simple threshold
                    best_sim = sim
                    best_group = g_id
            
            if best_sim >= 0.7:
                groups[best_group].append(idx)
            else:
                groups[len(groups)] = [idx]
    
    # Generate report content
    report_lines = [
        "=" * 80,
        "DupliDetect Analysis Summary Report",
        "=" * 80,
        f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "DATABASE STATISTICS",
        "-" * 80,
        f"Total Records: {len(records)}",
        f"Unique Languages: {len(langs)}",
        f"Language Distribution: {', '.join(f'{k}({v})' for k, v in sorted(langs.items()))}",
        f"Detected Groups: {len([g for g in groups.values() if len(g) > 1])}",
        "",
        "SAMPLE RECORDS (First 10)",
        "-" * 80,
    ]
    
    for idx, rec in enumerate(records[:10]):
        report_lines.append(f"{idx + 1}. [{rec.get('language', 'unknown')}] {rec.get('text', '')[:60]}...")
    
    if len(records) > 10:
        report_lines.append(f"... and {len(records) - 10} more records")
    
    report_lines.extend([
        "",
        "DUPLICATE GROUPS",
        "-" * 80,
    ])
    
    group_count = 0
    for g_id, g_indices in sorted(groups.items()):
        if len(g_indices) > 1:
            group_count += 1
            report_lines.append(f"Group {group_count} ({len(g_indices)} items):")
            for idx in g_indices[:3]:
                report_lines.append(f"  - [{records[idx].get('language', 'unknown')}] {records[idx].get('text', '')[:50]}...")
            if len(g_indices) > 3:
                report_lines.append(f"  ... and {len(g_indices) - 3} more")
    
    if group_count == 0:
        report_lines.append("No duplicate groups detected above threshold.")
    
    report_lines.extend([
        "",
        "CONFIGURATION",
        "-" * 80,
        f"Model: {MODEL_NAME}",
        f"Default Threshold: {DEFAULT_THRESHOLD}",
        f"W_SEM: {DEFAULT_W_SEM}, W_PHO: {DEFAULT_W_PHO}, W_CON: {DEFAULT_W_CON}",
        "",
        "=" * 80,
    ])
    
    return {
        "title": "DupliDetect Summary Report",
        "timestamp": datetime.datetime.now().isoformat(),
        "total_records": len(records),
        "unique_languages": sorted(langs.keys()),
        "duplicate_groups_detected": group_count,
        "content": "\n".join(report_lines)
    }


from fastapi.responses import PlainTextResponse


@app.get(
    "/report/download",
    tags=["Records"],
    summary="Download report as text file",
    description="Download the summary report as a text file.",
)
def download_report():
    """Download report as text file."""
    report = generate_report()
    return PlainTextResponse(report["content"], filename="duplidetect_report.txt")



@app.get(
    "/records",
    response_model=list[Record],
    tags=["Records"],
    summary="List stored records",
    description="Returns all records (id, text, language, item, description, amount).",
)
def list_records():
    return [Record(
        id=r["id"],
        text=r["text"],
        language=r.get("language", "unknown"),
        item=r.get("item"),
        description=r.get("description"),
        amount=r.get("amount")
    ) for r in _all_records()]


@app.get(
    "/export-csv",
    tags=["Records"],
    summary="Export records as CSV",
    description="Returns all records as CSV data.",
)
def export_csv():
    records = _all_records()
    if not records:
        return "id,text,language,item,description,amount\n"

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "text", "language", "item", "description", "amount"])
    for r in records:
        writer.writerow([
            r["id"],
            r["text"],
            r.get("language", "unknown"),
            r.get("item", ""),
            r.get("description", ""),
            r.get("amount", "")
        ])
    return output.getvalue()


@app.delete(
    "/records/{record_id}",
    tags=["Records"],
    summary="Delete a record",
    description="Deletes the record by id from the active storage backend.",
)
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
