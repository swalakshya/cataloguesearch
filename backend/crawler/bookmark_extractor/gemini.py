import json
import logging
import os
import google.generativeai as genai
from typing import List, Dict, Any, Optional

from .base import BookmarkExtractor

log_handle = logging.getLogger(__name__)


class GeminiBookmarkExtractor(BookmarkExtractor):
    """
    Gemini implementation for bookmark extraction.
    Uses Google Gemini API via the google-generativeai package.
    Requires GEMINI_API_KEY environment variable.
    """

    def __init__(self, model: str = "gemini-2.0-flash"):
        """
        Args:
            model: Gemini model name (default: gemini-2.0-flash)
        """
        super().__init__()
        genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
        self.model = genai.GenerativeModel(
            model_name=model,
            system_instruction=self.system_prompt,
        )
        log_handle.info("Initialized GeminiBookmarkExtractor with model: %s", model)

    def call_llm(self, indexed_titles: List[Dict[str, Any]]) -> Optional[List[Dict[str, str]]]:
        """
        Call Gemini API to extract data from bookmark titles.

        Args:
            indexed_titles: List of dicts with 'index' and 'title' keys

        Returns:
            List of dicts with extracted fields, or None if failed
        """
        user_message = (
            "Parse the following list of indexed bookmark titles and return the results:\n\n"
            + json.dumps(indexed_titles, ensure_ascii=False)
        )

        try:
            response = self.model.generate_content(
                user_message,
                generation_config={"response_mime_type": "application/json"},
            )

            result = json.loads(response.text)
            log_handle.info("Gemini returned %d items", len(result))
            log_handle.info("Response: %s", result)
            return result

        except json.JSONDecodeError as e:
            log_handle.error("Failed to parse Gemini JSON response: %s", e)
            log_handle.error("Raw response: %s", response.text if 'response' in locals() else 'N/A')
            return None
        except Exception as e:
            log_handle.error("Gemini API call failed: %s", e)
            return None
