"""Compatibility imports for the shared Auto Tesseract implementation."""
from backend.crawler.auto_tesseract import annotate_regions, detect_layout, order_regions

__all__ = ["annotate_regions", "detect_layout", "order_regions"]
