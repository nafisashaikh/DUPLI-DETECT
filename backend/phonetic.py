from __future__ import annotations

import os
import re
from typing import Any

import langdetect
import epitran
from rapidfuzz.distance import Levenshtein

# Global cache for loaded Epitran instances to avoid repeated initialization.
ep_cache: dict[str, Any] = {}

# Supported Epitran language codes for Brain 2 phonetic transcription.
EPITRAN_LANG_MAP: dict[str, str] = {
    "en": "eng-Latn",
    "ar": "ara-Arab",
    "hi": "hin-Deva",
    "ja": "jpn-Hira",
    "fr": "fra-Latn",
    "de": "deu-Latn",
    "es": "spa-Latn",
    "tr": "tur-Latn",
    "ru": "rus-Cyrl",
}

FALLBACK_SCORE = 0.5
MAX_PHONETIC_CHARS = int(os.getenv("MAX_PHONETIC_CHARS", "256"))


def _normalize_for_phonetic(text: str) -> str:
    # Keep a compact representative slice for faster language detection/transliteration.
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) > MAX_PHONETIC_CHARS:
        t = t[:MAX_PHONETIC_CHARS]
    return t


def _detect_language(text: str) -> dict[str, Any]:
    """Detect language with langdetect and return the label plus confidence."""
    try:
        result = langdetect.detect_langs(text)
        if result:
            top_result = result[0]
            return {"lang": str(top_result.lang), "score": float(top_result.prob)}
    except Exception:
        pass
    return {"lang": "", "score": 0.0}


def _get_epitran(lang: str) -> Any | None:
    """Return a cached Epitran instance for the requested language, or None if unsupported."""
    code = EPITRAN_LANG_MAP.get(lang)
    if not code:
        return None
    if code in ep_cache:
        return ep_cache[code]
    try:
        ep = epitran.Epitran(code)
        ep_cache[code] = ep
        return ep
    except Exception:
        return None


def get_phonetic_similarity(text1: str, text2: str) -> float:
    """Return a phonetic similarity score between 0 and 1 using phonetic transcription.

    The function uses langdetect to infer the language for each input text,
    then uses Epitran to transliterate both texts into IPA. The phonetic similarity
    is calculated as 1 minus the normalized Levenshtein distance between the two IPA
    strings.

    Fallback behavior:
    - if either language detection confidence is below 0.5
    - if either language is not supported by Epitran
    - if both IPA outputs are empty
    - if any exception occurs

    In all fallback cases, this function returns 0.5 to preserve a neutral score for
    Brain 2.
    """
    try:
        t1 = _normalize_for_phonetic(text1)
        t2 = _normalize_for_phonetic(text2)
        if not t1 or not t2:
            return FALLBACK_SCORE

        lang1 = _detect_language(t1)
        lang2 = _detect_language(t2)

        if lang1["score"] < 0.5 or lang2["score"] < 0.5:
            return FALLBACK_SCORE

        ep1 = _get_epitran(lang1["lang"])
        ep2 = _get_epitran(lang2["lang"])
        if ep1 is None or ep2 is None:
            return FALLBACK_SCORE

        ipa1 = ep1.transliterate(t1) or ""
        ipa2 = ep2.transliterate(t2) or ""

        if not ipa1 and not ipa2:
            return FALLBACK_SCORE

        distance = Levenshtein.normalized_distance(ipa1, ipa2)
        similarity = 1.0 - distance
        return max(0.0, min(1.0, similarity))
    except Exception:
        return FALLBACK_SCORE
