"""
Multi-provider LLM extractor for eval/testing.
Supports Gemini, Claude (Anthropic), and GPT-4o (OpenAI) for scripture OCR.
Not used in the main crawling pipeline — eval only.
"""
import base64
import io
import json
import logging
import os

from backend.crawler.llm_pdf_processor import PROMPT, extract_indic_text

log_handle = logging.getLogger(__name__)

# Model name prefixes used for routing
_CLAUDE_PREFIX = "claude-"
_OPENAI_PREFIX = "gpt-"

ALLOWED_MODELS = [
    # Gemini
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    # Claude
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    # OpenAI
    "gpt-4o",
    "gpt-4o-mini",
]


def _pil_to_base64(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _parse_json_response(raw: str) -> list:
    """Strip optional markdown fences and parse JSON array."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


def _extract_claude(image, model_name: str) -> list:
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

    client = anthropic.Anthropic(api_key=api_key)
    image_data = _pil_to_base64(image)

    response = client.messages.create(
        model=model_name,
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": image_data,
                    },
                },
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    return _parse_json_response(response.content[0].text)


def _extract_openai(image, model_name: str) -> list:
    from openai import OpenAI
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    client = OpenAI(api_key=api_key)
    image_data = _pil_to_base64(image)

    response = client.chat.completions.create(
        model=model_name,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_data}"},
                },
                {"type": "text", "text": PROMPT},
            ],
        }],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content
    parsed = json.loads(raw)
    # GPT-4o with json_object wraps arrays in a key sometimes
    if isinstance(parsed, list):
        return parsed
    # unwrap if nested e.g. {"blocks": [...]}
    for v in parsed.values():
        if isinstance(v, list):
            return v
    return []


def extract_indic_text_any(image, model_name: str) -> list:
    """
    Unified dispatcher — routes to the right provider based on model name prefix.
    Returns list of {"type": ..., "text": ...} dicts.
    """
    if model_name.startswith(_CLAUDE_PREFIX):
        log_handle.info(f"Using Claude extractor: {model_name}")
        return _extract_claude(image, model_name)
    elif model_name.startswith(_OPENAI_PREFIX):
        log_handle.info(f"Using OpenAI extractor: {model_name}")
        return _extract_openai(image, model_name)
    else:
        log_handle.info(f"Using Gemini extractor: {model_name}")
        return extract_indic_text(image, model_name=model_name)
