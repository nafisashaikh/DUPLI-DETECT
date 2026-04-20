from __future__ import annotations

import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

# Concept matcher for Brain 3.
# Loads a static concept map once and exposes a simple matching score.

STOPWORDS = {"the", "a", "an", "is", "in", "of", "and", "or", "to", "for", "with"}
_DEFAULT_MAP_FILENAME = "concept_map.json"

try:
    from rapidfuzz import fuzz
except Exception:
    fuzz = None


class ConceptMatcher:
    """Load a concept map and perform lightweight term matching.

    This class builds a reverse index from terms to concept IDs. It is intended to
    be a small and replaceable module for Brain 3. Future implementations can
    swap the internal matcher while preserving the public get_concept_score() API.
    """

    def __init__(self, json_path: str | None = None):
        self.json_path = self._resolve_json_path(json_path)
        self.concepts = self._load_concept_map(self.json_path)
        self.term_to_concept = self._build_reverse_index(self.concepts)
        self.max_term_tokens = self._compute_max_term_tokens(self.term_to_concept.keys())
        self.known_terms = list(self.term_to_concept.keys())
        self.fuzzy_threshold = int(os.getenv("CONCEPT_FUZZY_THRESHOLD", "80"))

    def _resolve_json_path(self, json_path: str | None) -> Path:
        if json_path:
            path = Path(json_path).expanduser()
            if not path.is_absolute():
                path = Path(__file__).parent / path
            return path

        env_path = os.getenv("CONCEPT_MAP_PATH")
        if env_path:
            path = Path(env_path).expanduser()
            if not path.is_absolute():
                path = Path(__file__).parent / path
            return path

        return Path(__file__).parent / _DEFAULT_MAP_FILENAME

    def _load_concept_map(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        concepts = data.get("concepts", {})
        if not isinstance(concepts, dict):
            raise ValueError("Concept map JSON must contain a top-level 'concepts' object")
        return concepts

    def _build_reverse_index(self, concepts: dict[str, Any]) -> dict[str, str]:
        reverse_index: dict[str, str] = {}
        for concept_id, values in concepts.items():
            if not isinstance(values, dict):
                continue
            for term_list in values.values():
                if not isinstance(term_list, list):
                    continue
                for term in term_list:
                    if not isinstance(term, str):
                        continue
                    normalized_term = self._normalize_text(term)
                    if normalized_term:
                        reverse_index[normalized_term] = concept_id
        return reverse_index

    def _compute_max_term_tokens(self, terms: Any) -> int:
        max_tokens = 1
        for term in terms:
            token_count = len(term.split())
            if token_count > max_tokens:
                max_tokens = token_count
        return max_tokens

    def _normalize_text(self, text: str) -> str:
        lowered = (text or "").strip().lower()
        lowered = "".join(
            ch for ch in unicodedata.normalize("NFKD", lowered)
            if not unicodedata.combining(ch)
        )
        # keep unicode letters/digits and convert separators/punctuation to spaces
        lowered = re.sub(r"[^\w\s]", " ", lowered, flags=re.UNICODE)
        lowered = re.sub(r"\s+", " ", lowered, flags=re.UNICODE).strip()
        return lowered

    def _extract_terms(self, text: str) -> list[str]:
        if not text or not text.strip():
            return []
        normalized = self._normalize_text(text)
        if not normalized:
            return []
        return [
            token for token in normalized.split()
            if len(token) > 1 and token not in STOPWORDS
        ]

    def _extract_concepts(self, text: str) -> set[str]:
        concept_ids: set[str] = set()
        tokens = self._extract_terms(text)
        if not tokens:
            return concept_ids

        # Match longest n-grams first so multi-word concepts ("new york", "apple inc")
        # are captured reliably instead of only single-token matches.
        max_n = min(self.max_term_tokens, len(tokens))
        for n in range(max_n, 0, -1):
            for i in range(0, len(tokens) - n + 1):
                phrase = " ".join(tokens[i:i + n])
                concept_id = self._resolve_concept_id(phrase)
                if concept_id:
                    concept_ids.add(concept_id)
        return concept_ids

    def _fuzzy_score(self, left: str, right: str) -> int:
        if fuzz is not None:
            # Blend metrics to catch spelling variants/transliterations and token differences.
            ratio = float(fuzz.ratio(left, right))
            partial = float(fuzz.partial_ratio(left, right))
            token = float(fuzz.token_set_ratio(left, right))
            return int(max(ratio, partial, token))

        # Fallback without extra dependency.
        from difflib import SequenceMatcher
        return int(100 * SequenceMatcher(None, left, right).ratio())

    def _resolve_concept_id(self, phrase: str) -> str | None:
        exact = self.term_to_concept.get(phrase)
        if exact:
            return exact

        # Fuzzy matching for close language variants/transliterations (e.g., mango/mangue).
        # This keeps matching data-driven from concept_map.json, without hardcoded synonyms.
        if not phrase or len(phrase) < 3:
            return None

        best_term = ""
        best_score = -1
        for term in self.known_terms:
            if abs(len(term) - len(phrase)) > 3:
                continue
            if term[0] != phrase[0]:
                continue
            score = self._fuzzy_score(phrase, term)
            if score > best_score:
                best_score = score
                best_term = term

        if best_score >= self.fuzzy_threshold and best_term:
            return self.term_to_concept.get(best_term)
        return None

    def get_concept_score(self, text1: str, text2: str) -> float:
        try:
            concepts1 = self._extract_concepts(text1)
            concepts2 = self._extract_concepts(text2)
            if not concepts1 or not concepts2:
                return 0.0
            overlap = len(concepts1.intersection(concepts2))
            union = len(concepts1.union(concepts2))
            if union == 0:
                return 0.0
            return overlap / union
        except Exception:
            return 0.0


_default_matcher: ConceptMatcher | None = None


def _get_default_matcher() -> ConceptMatcher:
    global _default_matcher
    if _default_matcher is None:
        _default_matcher = ConceptMatcher()
    return _default_matcher


def get_concept_score(text1: str, text2: str) -> float:
    return _get_default_matcher().get_concept_score(text1, text2)
