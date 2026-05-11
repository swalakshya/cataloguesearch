import json
import logging
import requests
from typing import List, Dict, Any, Optional

from .base import BookmarkExtractor

log_handle = logging.getLogger(__name__)


class OllamaBookmarkExtractor(BookmarkExtractor):
    """
    Ollama implementation for bookmark extraction.
    Uses local Ollama models for completely offline, private inference.
    """

    def __init__(self, model: str = "phi4:14b", base_url: str = "http://localhost:11434"):
        """
        Initialize Ollama bookmark extractor.

        Args:
            model: Ollama model name to use (default: gpt-oss:20b)
                   Other options: qwen2.5:7b, llama3.1:8b, phi4
            base_url: Ollama API base URL (default: http://localhost:11434)
        """
        super().__init__()
        self.model = model
        self.base_url = base_url
        self.api_url = f"{base_url}/api/chat"
        log_handle.info("Initialized OllamaBookmarkExtractor with model: %s", model)

    def call_llm(self, indexed_titles: List[Dict[str, Any]]) -> Optional[List[Dict[str, str]]]:
        """
        Call Ollama API to extract data from bookmark titles.

        Args:
            indexed_titles: List of dictionaries with 'index' and 'title' keys

        Returns:
            List of dictionaries with extracted data, or None if failed
        """
        indexed_titles_json = json.dumps(indexed_titles)
        log_handle.info(f"{indexed_titles_json}")

        # NuExtract expects a specific format - combine system prompt with user message
        full_prompt = f"""{self.system_prompt}

Parse the following list of indexed bookmark titles and return the results:

{indexed_titles_json}

CRITICAL: Return ONLY a valid JSON array. Do NOT include any explanations, markdown formatting, or additional text.
Your response must be a JSON array where each element has: index, page, pravachan_no, date, gatha, kalash, shlok, doha, kavya, sutra
Example format: [{{"index": 0, "page": 5, "pravachan_no": "244-A", "date": "07-11-1965", "gatha": null, "kalash": "219", "shlok": null, "doha": null, "kavya": null, "sutra": null}}, {{"index": 1, "page": 61, "pravachan_no": null, "date": null, "gatha": null, "kalash": null, "shlok": null, "doha": null, "kavya": "7", "sutra": null}}]"""

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": full_prompt
                }
            ],
            "stream": False,
            "options": {
                "temperature": 0,
                "num_predict": 50000,  # Allow very long responses for large batches
                "stop": []  # Don't stop on special tokens
            }
        }

        try:
            response = requests.post(
                self.api_url,
                json=payload,
                timeout=600
            )
            response.raise_for_status()

            result = response.json()

            # Extract JSON response from Ollama
            message_content = result.get('message', {}).get('content', '')

            if message_content:
                log_handle.info("Successfully received response from Ollama API")
                # Log first 500 chars of response for debugging
                log_handle.info("Response: %s", message_content)

                # Strip markdown code blocks if present
                cleaned_content = message_content.strip()
                if cleaned_content.startswith('```'):
                    # Find the first newline after opening backticks
                    first_newline = cleaned_content.find('\n')
                    if first_newline != -1:
                        # Remove first line (```json or just ```)
                        cleaned_content = cleaned_content[first_newline + 1:]

                    # Remove closing backticks
                    if cleaned_content.endswith('```'):
                        cleaned_content = cleaned_content[:-3]

                    cleaned_content = cleaned_content.strip()
                    log_handle.info("Stripped markdown code blocks from response")

                parsed_response = json.loads(cleaned_content)
                log_handle.info("Parsed response type: %s, keys: %s", type(parsed_response), list(parsed_response.keys()) if isinstance(parsed_response, dict) else 'N/A')

                # Handle different response formats
                # Ollama might return {"results": [...]} or just [...]
                if isinstance(parsed_response, list):
                    parsed_data = parsed_response
                elif isinstance(parsed_response, dict):
                    # Check if it's a wrapper object with results
                    if 'results' in parsed_response or 'data' in parsed_response or 'bookmarks' in parsed_response:
                        parsed_data = (parsed_response.get('results') or
                                     parsed_response.get('data') or
                                     parsed_response.get('bookmarks'))
                    # Check if it's a single result object (has 'index' key)
                    elif 'index' in parsed_response:
                        # Wrap single object in a list
                        log_handle.info("Model returned single object, wrapping in array")
                        parsed_data = [parsed_response]
                    # Check if keys are numeric strings like "0", "1", "2" (dict used as array)
                    elif parsed_response and all(key.isdigit() for key in list(parsed_response.keys())[:min(10, len(parsed_response))]):
                        # Model returned dict with numeric keys instead of array
                        # Convert to list sorted by numeric key
                        log_handle.info("Model returned dict with numeric string keys, converting to array")
                        sorted_items = sorted(parsed_response.items(), key=lambda x: int(x[0]))
                        parsed_data = [item[1] for item in sorted_items]
                    else:
                        # Try first value as fallback
                        first_val = list(parsed_response.values())[0] if parsed_response else None
                        parsed_data = first_val if isinstance(first_val, list) else None
                else:
                    log_handle.error("Unexpected response format: %s", type(parsed_response))
                    parsed_data = None

                if parsed_data:
                    # Post-process: Convert "N/A" strings to None
                    for item in parsed_data:
                        for field in ('pravachan_no', 'date', 'gatha', 'kalash', 'shlok', 'doha', 'kavya', 'sutra'):
                            if item.get(field) == 'N/A':
                                item[field] = None

                    log_handle.info("Successfully extracted %d items", len(parsed_data))
                    return parsed_data
                else:
                    log_handle.warning("Could not extract data from response")

            else:
                log_handle.warning("Received empty response from Ollama")

        except requests.exceptions.ConnectionError as e:
            log_handle.error("Failed to connect to Ollama. Is Ollama running? Error: %s", e)
            log_handle.error("Make sure Ollama is running: 'ollama serve' or check if Ollama app is running")

        except requests.exceptions.RequestException as e:
            log_handle.error("Error calling Ollama API: %s", e)
            if hasattr(e, 'response') and e.response is not None:
                log_handle.error("Response content: %s", e.response.text)

        except json.JSONDecodeError as e:
            log_handle.error("Error decoding JSON response from Ollama: %s", e)
            log_handle.error("Raw response: %s", message_content if 'message_content' in locals() else 'N/A')

        return None