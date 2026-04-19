from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

# Concept matcher for Brain 3.
# Loads a static concept map once and exposes a simple matching score.

STOPWORDS = {"the", "a", "an", "is", "in", "of", "and", "or", "to", "for", "with"}
_DEFAULT_MAP_FILENAME = "concept_map.json"


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
                    reverse_index[term.lower()] = concept_id
        return reverse_index

    def _is_latin_cyrillic_greek(self, text: str) -> bool:
        return bool(re.search(r"[\u0041-\u024F\u0370-\u03FF\u0400-\u04FF]", text))

    def _extract_terms(self, text: str) -> list[str]:
        if not text or not text.strip():
            return []

        if self._is_latin_cyrillic_greek(text):
            return [match.group(0).lower() for match in re.finditer(r"\b[A-Z][a-z]+\b", text)]

        tokens = re.split(r"[^\w]+", text)
        return [token.lower() for token in tokens if len(token) > 1 and token.lower() not in STOPWORDS]

    def _extract_concepts(self, text: str) -> set[str]:
        concept_ids: set[str] = set()
        for term in self._extract_terms(text):
            concept_id = self.term_to_concept.get(term)
            if concept_id:
                concept_ids.add(concept_id)
        return concept_ids

    def get_concept_score(self, text1: str, text2: str) -> float:
        try:
            concepts1 = self._extract_concepts(text1)
            concepts2 = self._extract_concepts(text2)
            return 1.0 if concepts1.intersection(concepts2) else 0.0
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
