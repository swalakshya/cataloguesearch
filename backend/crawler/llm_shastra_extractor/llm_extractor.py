import google.generativeai as genai
import PIL.Image
import json
import os

# 1. Setup your API Key
# Get one at: https://aistudio.google.com/
os.environ["GOOGLE_API_KEY"] = "YOUR_API_KEY_HERE"
genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

def extract_indic_text(image_path):
    # 2. Initialize the model
    # 'gemini-1.5-pro' is recommended for complex multilingual layouts
    model = genai.GenerativeModel('gemini-1.5-pro')

    # 3. Load the image
    img = PIL.Image.open(image_path)

    # 4. Define the prompt (replicating our current logic)
    prompt = """
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

    # 5. Generate Response
    # Setting response_mime_type to application/json ensures structured output
    response = model.generate_content(
        [prompt, img],
        generation_config={"response_mime_type": "application/json"}
    )

    return json.loads(response.text)

# Example Usage:
if __name__ == "__main__":
    try:
        path_to_image = "your_screenshot.jpg"
        result = extract_indic_text(path_to_image)

        # Print the formatted JSON
        print(json.dumps(result, indent=2, ensure_ascii=False))

    except Exception as e:
        print(f"Error: {e}")