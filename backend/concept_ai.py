"""
Brain 3: AI-Powered Concept Matcher using NVIDIA LLM API
Universal concept extraction and comparison - no hardcoded knowledge base needed.
"""
from __future__ import annotations

import os
import json
import hashlib
import time
from typing import Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv(".env.local", override=True)

try:
    import requests
except ImportError:
    requests = None

# NVIDIA API Configuration
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")
NVIDIA_LLM_BASE_URL = os.environ.get("NVIDIA_LLM_BASE_URL", "https://integrate.api.nvidia.com")
# Use a cost-effective model for concept extraction
NVIDIA_LLM_MODEL = os.environ.get("NVIDIA_LLM_MODEL", "meta/llama-3.1-8b-instruct")

# Cache for concept extractions to reduce API calls
_concept_cache = {}
_cache_lock = None

try:
    import threading
    _cache_lock = threading.Lock()
except ImportError:
    pass


class AIConceptMatcher:
    """
    Universal concept matcher using NVIDIA LLM API.
    Extracts key concepts, entities, and topics from text dynamically.
    No hardcoded knowledge base - works with ANY domain/language.
    """

    def __init__(self):
        self.api_key = NVIDIA_API_KEY
        self.base_url = NVIDIA_LLM_BASE_URL.rstrip("/")
        self.model = NVIDIA_LLM_MODEL
        self.use_ai = bool(self.api_key and self.api_key.startswith("nvapi-"))
        
        # Fallback to simple keyword matching if API not available
        if not self.use_ai:
            print("⚠️  NVIDIA API key not found. Brain 3 using fallback keyword matching.")
            print("   Set NVIDIA_API_KEY in .env for AI-powered concept extraction.")
        
        print(f"🧠 Brain 3: AI Concept Matcher initialized (model: {self.model})")

    def _get_cache_key(self, text: str) -> str:
        """Generate cache key for text."""
        return hashlib.md5(text.lower().strip().encode('utf-8')).hexdigest()

    def _get_cached_concepts(self, text: str) -> Optional[dict]:
        """Get concepts from cache if available."""
        if not _cache_lock:
            return _concept_cache.get(self._get_cache_key(text))
        
        with _cache_lock:
            return _concept_cache.get(self._get_cache_key(text))

    def _cache_concepts(self, text: str, concepts: dict):
        """Cache extracted concepts."""
        if not _cache_lock:
            _concept_cache[self._get_cache_key(text)] = concepts
        else:
            with _cache_lock:
                _concept_cache[self._get_cache_key(text)] = concepts

    def _extract_concepts_ai(self, text: str) -> dict:
        """
        Extract concepts using NVIDIA LLM API.
        Returns structured JSON with concepts, entities, topics, and domain.
        """
        # Always try AI first, fallback to enhanced keyword extraction
        if not self.use_ai or requests is None:
            return self._extract_concepts_fallback(text)

        # Check cache first
        cached = self._get_cached_concepts(text)
        if cached:
            return cached

        prompt = f"""Extract the key concepts, entities, and topics from the following text. 
Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{{
  "concepts": ["list", "of", "main", "concepts"],
  "entities": ["specific", "named", "entities"],
  "topics": ["broad", "topic", "areas"],
  "domain": "primary domain/category",
  "language": "detected language code (en, ja, hi, zh, ar, etc.)"
}}

IMPORTANT RULES:
- Return ONLY the JSON object, nothing else
- Extract both explicit and implicit concepts
- Include domain-specific terminology
- Keep concepts concise (1-3 words each)
- Detect the language accurately
- Translate key concepts to English for comparison
- For "りんごは果物です", extract: ["apple", "fruit"]
- For "Apple is fruit", extract: ["apple", "fruit"]

Text: {text}"""

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 500,
                "top_p": 0.9
            }

            url = f"{self.base_url}/v1/chat/completions"
            # Increase timeout to 30 seconds for better reliability
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            content = result["choices"][0]["message"]["content"].strip()
            
            # Parse JSON from response
            # Sometimes LLM wraps JSON in markdown code blocks
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            content = content.strip()
            
            concepts_data = json.loads(content)
            
            # Normalize the extracted concepts
            normalized_concepts = {
                "concepts": [c.lower().strip() for c in concepts_data.get("concepts", []) if c],
                "entities": [e.lower().strip() for e in concepts_data.get("entities", []) if e],
                "topics": [t.lower().strip() for t in concepts_data.get("topics", []) if t],
                "domain": concepts_data.get("domain", "").lower().strip(),
                "language": concepts_data.get("language", "unknown").lower().strip()
            }
            
            # Cache the result
            self._cache_concepts(text, normalized_concepts)
            
            return normalized_concepts

        except Exception as e:
            print(f"⚠️  AI concept extraction failed: {e}")
            print("   Falling back to enhanced keyword extraction with translation")
            return self._extract_concepts_fallback(text)

    def _extract_concepts_fallback(self, text: str) -> dict:
        """
        Enhanced fallback concept extraction when AI API is unavailable.
        Uses translation APIs and multilingual NLP techniques.
        """
        import re
        from collections import Counter
        
        # Common stopwords in multiple languages
        stopwords = {
            'en': {'the', 'a', 'an', 'is', 'in', 'of', 'and', 'or', 'to', 'for', 'with', 
                   'it', 'this', 'that', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
                   'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
                   'on', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
                   'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then',
                   'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
                   'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
                   'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'don',
                   'great', 'good', 'nice', 'wonderful', 'amazing'},
            'ja': {'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'や', 'か', 'から', 
                   'まで', 'へ', 'ば', 'たり', 'て', 'だ', 'です', 'ます', 'ある', 'いる',
                   'では', 'という', 'なる', 'する'},
            'hi': {'है', 'में', 'और', 'को', 'से', 'के', 'का', 'की', 'ने', 'पर', 'तो', 
                   'भी', 'ही', 'है', 'था', 'थी', 'थे', 'कर', 'करना', 'करने'},
        }
        
        # Detect language
        has_japanese = any('\u4e00' <= c <= '\u9fff' or '\u3040' <= c <= '\u309f' or '\u30a0' <= c <= '\u30ff' for c in text)
        has_hindi = any('\u0900' <= c <= '\u097f' for c in text)
        has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
        
        if has_japanese:
            lang = 'ja'
        elif has_hindi:
            lang = 'hi'
        elif has_chinese:
            lang = 'zh'
        else:
            lang = 'en'
        
        # Extract words/tokens
        if lang in ['ja', 'zh']:
            # Extract character sequences and words
            tokens = re.findall(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u0900-\u097f\w]{2,}', text.lower())
            # Also split Japanese text into meaningful chunks
            jp_words = re.findall(r'[\u3040-\u309f\u30a0-\u30ff]{2,}|[\u4e00-\u9fff]+', text)
            tokens.extend(jp_words)
        else:
            tokens = re.findall(r'\b\w{2,}\b', text.lower())
        
        # Remove stopwords
        stop_words = stopwords.get(lang, set())
        filtered_tokens = [t for t in tokens if t not in stop_words]
        
        # Try to translate to English using free translation API
        translated_tokens = []
        if lang != 'en' and filtered_tokens:
            try:
                # Use MyMemory Translation API (free, no key needed)
                import urllib.request
                import urllib.parse
                
                # Translate first few unique tokens to keep it fast
                unique_tokens = list(set(filtered_tokens))[:5]
                for token in unique_tokens:
                    try:
                        # MyMemory API
                        url = f"https://api.mymemory.translated.net/get?q={urllib.parse.quote(token)}&langpair={lang}|en"
                        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(req, timeout=5) as response:
                            data = json.loads(response.read().decode())
                            translated = data.get('responseData', {}).get('translatedText', '')
                            if translated and translated.lower() != token.lower():
                                translated_tokens.append(translated.lower())
                    except:
                        pass
            except Exception as e:
                print(f"   Translation API failed: {e}")
        
        # Combine original and translated tokens
        all_concepts = filtered_tokens + translated_tokens
        
        # Get unique concepts
        unique_concepts = list(set(all_concepts))
        
        return {
            "concepts": unique_concepts[:10],
            "entities": [],
            "topics": unique_concepts[:5],
            "domain": "general",
            "language": lang
        }

    def calculate_concept_similarity(self, text1: str, text2: str) -> float:
        """
        Calculate concept similarity between two texts.
        Returns a score between 0.0 and 1.0.
        """
        try:
            # Extract concepts from both texts
            concepts1 = self._extract_concepts_ai(text1)
            concepts2 = self._extract_concepts_ai(text2)
            
            # Get the raw extracted terms (before expansion) for primary matching
            raw_concepts1 = set(self._extract_terms_simple(text1))
            raw_concepts2 = set(self._extract_terms_simple(text2))
            
            # Get expanded concepts (with translations)
            all_concepts1 = set(
                concepts1.get("concepts", []) + 
                concepts1.get("entities", []) + 
                concepts1.get("topics", [])
            )
            
            all_concepts2 = set(
                concepts2.get("concepts", []) + 
                concepts2.get("entities", []) + 
                concepts2.get("topics", [])
            )
            
            # If no concepts extracted, return 0
            if not all_concepts1 or not all_concepts2:
                return 0.0
            
            # Method 1: Check if ANY raw term from text1 matches expanded concepts of text2
            # This handles "apple" vs "りんご" perfectly
            direct_match_score = 0.0
            if raw_concepts1 and raw_concepts2:
                # Check if any term from text1 exists in text2's expanded concepts
                matches_t1_in_t2 = len(raw_concepts1.intersection(all_concepts2))
                matches_t2_in_t1 = len(raw_concepts2.intersection(all_concepts1))
                
                # Bidirectional matching - both should match for high score
                if matches_t1_in_t2 > 0 and matches_t2_in_t1 > 0:
                    direct_match_score = 1.0  # Perfect match!
                elif matches_t1_in_t2 > 0 or matches_t2_in_t1 > 0:
                    direct_match_score = 0.85  # One-way match (still strong)
            
            # Method 2: Jaccard similarity on expanded concepts (fallback)
            intersection = all_concepts1.intersection(all_concepts2)
            union = all_concepts1.union(all_concepts2)
            jaccard_score = len(intersection) / len(union) if union else 0.0
            
            # Use the HIGHER of the two methods
            base_score = max(direct_match_score, jaccard_score)
            
            # Boost score if domain matches
            domain_boost = 0.0
            if (concepts1.get("domain") and concepts2.get("domain") and 
                concepts1["domain"] == concepts2["domain"]):
                domain_boost = 0.1
            
            # Boost score if discussing same entities
            entities1 = set(concepts1.get("entities", []))
            entities2 = set(concepts2.get("entities", []))
            entity_overlap = len(entities1.intersection(entities2))
            entity_boost = min(0.15, entity_overlap * 0.075)
            
            # Final score (capped at 1.0)
            final_score = min(1.0, base_score + domain_boost + entity_boost)
            
            return final_score

        except Exception as e:
            print(f"⚠️  Concept similarity calculation failed: {e}")
            return 0.0
    
    def _extract_terms_simple(self, text: str) -> set:
        """Extract simple terms from text for matching."""
        import re
        
        # Detect language
        has_japanese = any('\u4e00' <= c <= '\u9fff' or '\u3040' <= c <= '\u309f' or '\u30a0' <= c <= '\u30ff' for c in text)
        has_hindi = any('\u0900' <= c <= '\u097f' for c in text)
        
        if has_japanese:
            # Extract Japanese words
            tokens = re.findall(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+', text)
        elif has_hindi:
            # Extract Hindi words
            tokens = re.findall(r'[\u0900-\u097f]+', text)
        else:
            # Extract English/alphabetic words
            tokens = re.findall(r'\b[a-zA-Z]{2,}\b', text.lower())
        
        # Remove common stopwords
        stopwords = {'the', 'a', 'an', 'is', 'in', 'of', 'and', 'or', 'to', 'for', 'with',
                     'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の'}
        
        return set(t for t in tokens if t.lower() not in stopwords)

    def get_concept_score(self, text1: str, text2: str) -> float:
        """
        Public API method - compatible with old interface.
        Returns concept similarity score between 0.0 and 1.0.
        """
        return self.calculate_concept_similarity(text1, text2)


# Singleton instance
_default_matcher: Optional[AIConceptMatcher] = None


def _get_default_matcher() -> AIConceptMatcher:
    """Get or create the default AI concept matcher."""
    global _default_matcher
    if _default_matcher is None:
        _default_matcher = AIConceptMatcher()
    return _default_matcher


def get_concept_score(text1: str, text2: str) -> float:
    """
    Get concept similarity score between two texts.
    Uses AI-powered extraction when NVIDIA API is available.
    Falls back to keyword-based extraction otherwise.
    """
    return _get_default_matcher().get_concept_score(text1, text2)
