import google.generativeai as genai
import PIL.Image
import json
import os
import logging

log_handle = logging.getLogger(__name__)

# Configure API key from environment.
# Get your key at: https://aistudio.google.com/apikey
# Then set it: export GOOGLE_API_KEY="your-key-here"
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))

PROMPT = """
The attached image is from a Jain Scripture. It has different types of text:

- Sanskrit text (often separated by lines or in blocks)
- Prakrit Verses
- Sanskrit Verses
- Hindi Verses
- Hindi text (which may contain sanskrit or prakrit words in brackets)
- Footnotes (usually at the bottom with smaller text or marked with small numbers)
- Chapter headings (will be in bigger font)

Your job is to parse the image and categorise each block of text into one of the above categories.

Valid values for "type":
- "sanskrit_text"
- "prakrit_text"
- "hindi_text"
- "sanskrit_verse"
- "prakrit_verse"
- "hindi_verse"
- "footnote"
- "chapter_heading"

Output a JSON array of objects, each with "type" and "text" keys. Example:
[
  {"type": "chapter_heading", "text": "अध्याय १"},
  {"type": "sanskrit_verse", "text": "ॐ नमो भगवते..."},
  {"type": "hindi_text", "text": "इसका अर्थ है..."},
  {"type": "footnote", "text": "१. यह पाठान्तर है"}
]

Preserve the order in which the text appears on the page. Output ONLY the JSON array.
"""


def extract_indic_text(image, model_name="gemini-2.5-flash"):
    """
    Extract and categorise text blocks from a Jain scripture image using Gemini.

    Args:
        image: PIL.Image object of the page
        model_name: Gemini model to use (e.g. gemini-2.0-flash, gemini-2.5-flash, gemini-2.5-pro)

    Returns:
        List of dicts with "type" and "text" keys
    """
    log_handle.info(f"Running LLM extraction with model={model_name}")

    model = genai.GenerativeModel(model_name)

    response = model.generate_content(
        [PROMPT, image],
        generation_config={"response_mime_type": "application/json"}
    )

    result = json.loads(response.text)
    log_handle.info(f"LLM extraction returned {len(result)} blocks")
    log_handle.info(f"result: {result}")
    return result


# Example Usage:
if __name__ == "__main__":
    try:
        path_to_image = "your_screenshot.jpg"
        img = PIL.Image.open(path_to_image)
        result = extract_indic_text(img)

        # Print the formatted JSON
        print(json.dumps(result, indent=2, ensure_ascii=False))

    except Exception as e:
        print(f"Error: {e}")