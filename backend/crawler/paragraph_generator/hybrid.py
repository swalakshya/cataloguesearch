"""Keep ordinary runs on their existing generator; isolate Auto OCR regions."""
from backend.crawler.paragraph_generator.advanced import AdvancedParagraphGenerator


class HybridParagraphGenerator:
    def __init__(self, regular, config, language_meta):
        self.regular = regular
        self.auto = AdvancedParagraphGenerator(config, language_meta)

    def generate_paragraphs(self, pages_data, scan_config):
        result, regular_run = [], []

        def flush():
            if regular_run:
                result.extend(self.regular.generate_paragraphs(regular_run, scan_config))
                regular_run.clear()

        for entry in pages_data:
            data = entry[1] if isinstance(entry, tuple) else entry
            if isinstance(data, dict) and data.get("ocr_mode") == "auto_tesseract":
                flush()
                for region in data.get("regions", []):
                    result.extend(self.auto.generate_paragraphs([region], scan_config))
            else:
                regular_run.append(entry)
        flush()
        return result
