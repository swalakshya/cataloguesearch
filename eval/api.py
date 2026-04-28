from fastapi import APIRouter, FastAPI, HTTPException, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from utils.logger import setup_logging, VERBOSE_LEVEL_NUM
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import json
import os
import sys
import tempfile
import logging
import time
from datetime import datetime, timezone
import hashlib
import psutil
import uuid
import zipfile
import shutil
import concurrent.futures
import threading
import requests
import base64
import io

# OCR-specific imports
from PIL import Image

from backend.config import Config
from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.common.scan_config import get_scan_config
from backend.common.utils import get_merged_config
from backend.crawler.index_state import IndexState
from backend.crawler.bookmark_extractor.factory import create_bookmark_extractor_by_name
from backend.utils import json_dumps
from backend.crawler.llm_pdf_processor import BLOCK_TYPES
from eval.multi_llm import extract_indic_text_any, ALLOWED_MODELS as LLM_ALLOWED_MODELS
from backend.crawler.paragraph_generator.advanced import AdvancedParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import get_language_meta
from .ocr import get_ocr_service

log_handle = logging.getLogger(__name__)

# --- Removed old job tracking - now handled by EvalOCRService ---

router = APIRouter(prefix="/eval", tags=["evaluation"])

# --- Response Models ---
class PathsResponse(BaseModel):
    base_pdf_path: str
    base_text_path: str
    base_ocr_path: str

class TextBox(BaseModel):
    x: int
    y: int
    width: int
    height: int
    text: str
    confidence: int

class Paragraph(BaseModel):
    text: str
    boxes: List[TextBox]
    paragraph_type: str = ""

class OCRResponse(BaseModel):
    text: str
    boxes: List[TextBox]
    paragraphs: List[Paragraph]
    language: str
    ocr_json: Optional[Dict] = None
    scan_config: Optional[Dict] = None

class HealthResponse(BaseModel):
    status: str
    tesseract_version: Optional[str] = None
    error: Optional[str] = None

class BatchJobResponse(BaseModel):
    job_id: str

class BatchStatusResponse(BaseModel):
    status: str
    progress: int
    total_pages: int
    zip_filename: Optional[str] = None
    error: Optional[str] = None
    elapsed_time: Optional[float] = None
    elapsed_time_formatted: Optional[str] = None

class CostCalculationRequest(BaseModel):
    total_pages: int
    use_google_ocr: bool = False

class CostCalculationResponse(BaseModel):
    cost: str
    pages: int
    currency: str = "₹"

# --- Bookmark Extraction Models ---
class BookmarkExtractionRequest(BaseModel):
    bookmarks: List[Dict[str, Any]] = Field(..., description="List of bookmark objects with title, page, level")
    llm_provider: str = Field("groq", description="LLM provider to use: 'groq' or 'gemini'")

class BookmarkData(BaseModel):
    page: int
    level: int
    title: str
    pravachan_no: Optional[str] = None
    date: Optional[str] = None
    gatha: Optional[str] = None
    kalash: Optional[str] = None
    shlok: Optional[str] = None
    doha: Optional[str] = None
    kavya: Optional[str] = None
    sutra: Optional[str] = None

class BookmarkExtractionResponse(BaseModel):
    bookmarks: List[BookmarkData]
    total: int

# --- OCR Preview Models ---
class ScriptureLLMTextBlock(BaseModel):
    type: str
    text: str

class ScriptureLLMResponse(BaseModel):
    blocks: List[ScriptureLLMTextBlock]
    model: str
    language: str
    preview_image: str  # Base64 encoded cropped page image
    scan_config: Optional[Dict] = None

class PreviewPageData(BaseModel):
    page_number: int
    image_data: str  # Base64 encoded image

class OCRPreviewResponse(BaseModel):
    pages: List[PreviewPageData]
    total_pages: int
    offset: int
    limit: int

# --- Helper Functions ---
def get_memory_usage():
    """Get current memory usage in MB"""
    process = psutil.Process()
    return process.memory_info().rss / 1024 / 1024

# --- API Endpoints ---

@router.get("/paths", response_model=PathsResponse)
async def get_evaluation_paths():
    """
    Get the base paths for evaluation from the configuration.
    """
    try:
        # Initialize config (assuming it's already loaded)
        config = Config("configs/config.yaml")

        return PathsResponse(
            base_pdf_path=config.BASE_PDF_PATH,
            base_text_path=config.BASE_TEXT_PATH,
            base_ocr_path=config.BASE_OCR_PATH
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading configuration: {str(e)}")

@router.get("/ocr/scan-config")
async def get_file_scan_config(relative_path: str):
    """
    Get the scan_config for a PDF file from the base PDF folder.
    This returns merged configuration from scan_config.json files in the directory hierarchy.

    Args:
        relative_path: Relative path to the PDF file from the base PDF folder

    Returns:
        dict: Scan configuration with header_prefix, header_regex, page_list, crop, psm, etc.
    """
    try:
        config = Config("configs/config.yaml")
        base_pdf_folder = config.BASE_PDF_PATH
        file_path = os.path.join(base_pdf_folder, relative_path)

        # Validate file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {relative_path}")

        # Get scan config using the utility function
        scan_config = get_scan_config(file_path, base_pdf_folder)

        return scan_config

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error getting scan config: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting scan config: {str(e)}")

_LANG_TO_FOLDER = {
    "hi": "hindi", "hin": "hindi",
    "gu": "gujarati", "guj": "gujarati",
}

def _load_default_scan_config(language: str, subfolder: str) -> dict:
    """
    Load and flatten a default scan_config by passing a dummy PDF path
    inside BASE_PDF_PATH/<subfolder>/<lang_folder>/ to get_scan_config(),
    which handles the 'default' key extraction and hierarchy merging.
    """
    lang_folder = _LANG_TO_FOLDER.get(language.lower())
    if not lang_folder:
        return {}
    try:
        config = Config("configs/config.yaml")
        dummy_pdf = os.path.join(config.BASE_PDF_PATH, subfolder, lang_folder, "dummy.pdf")
        return get_scan_config(dummy_pdf, config.BASE_PDF_PATH)
    except Exception as e:
        log_handle.warning(f"Failed to load default scan_config from {subfolder}/{lang_folder}: {e}")
        return {}

@router.post("/ocr", response_model=OCRResponse)
async def process_ocr(
    image: UploadFile = File(None, description="Image file to process (not needed if relative_path and page_number are provided)"),
    language: str = Form("hin", description="Language code for OCR (hin, guj)"),
    crop_top: float = Form(0, description="Percentage to crop from top (0-50)"),
    crop_bottom: float = Form(0, description="Percentage to crop from bottom (0-50)"),
    crop_left: float = Form(0, description="Percentage to crop from left (0-50)"),
    crop_right: float = Form(0, description="Percentage to crop from right (0-50)"),
    relative_path: Optional[str] = Form(None, description="Relative path to PDF file from base folder"),
    page_number: Optional[int] = Form(None, description="Page number to extract from PDF (1-indexed, requires relative_path)"),
    use_default_scan_config: bool = Form(False, description="Load scan_config.json from base_dir/<language>/ when no relative_path is given")
):
    """
    Process OCR on an image.

    Two modes of operation:
    1. Upload mode: Provide 'image' file
    2. PDF extraction mode: Provide 'relative_path' and 'page_number' to extract page from PDF directly

    If relative_path is provided, the scan_config will be loaded from scan_config.json files
    in the directory hierarchy, providing header_prefix, header_regex, and other settings.
    """
    # Validate input: either image OR (relative_path + page_number)
    if not image and not (relative_path and page_number):
        raise HTTPException(status_code=400, detail="Either provide 'image' file OR both 'relative_path' and 'page_number'")

    if image and (relative_path and page_number):
        raise HTTPException(status_code=400, detail="Provide either 'image' file OR 'relative_path'+'page_number', not both")
    if not (0 <= crop_top <= 50 and 0 <= crop_bottom <= 50 and 0 <= crop_left <= 50 and 0 <= crop_right <= 50):
        raise HTTPException(status_code=400, detail="Crop percentages must be between 0 and 50")

    # Build scan_config
    scan_config = {}

    # If relative_path is provided, load scan_config from hierarchy
    if relative_path:
        try:
            config = Config("configs/config.yaml")
            base_pdf_folder = config.BASE_PDF_PATH
            file_path = os.path.join(base_pdf_folder, relative_path)
            if not file_path.endswith(".pdf"):
                file_path = f"{file_path}.pdf"

            if os.path.exists(file_path):
                log_handle.info(f"getting scan_config for {file_path} and base_folder {base_pdf_folder}")
                scan_config = get_scan_config(file_path, base_pdf_folder)
                log_handle.info(f"Loaded scan_config for {relative_path}: {scan_config.keys()}")
        except Exception as e:
            log_handle.warning(f"Failed to load scan_config for {relative_path}: {e}")

    # Upload/URL mode: load default scan_config from base_dir/Pravachans/<language>/
    elif use_default_scan_config:
        lang_folder = _LANG_TO_FOLDER.get(language.lower())
        if lang_folder:
            try:
                config = Config("configs/config.yaml")
                # Pass a dummy PDF path inside the language folder so get_scan_config
                # walks the hierarchy and correctly flattens the "default" key.
                dummy_pdf = os.path.join(config.BASE_PDF_PATH, "Pravachans", lang_folder, "dummy.pdf")
                scan_config = get_scan_config(dummy_pdf, config.BASE_PDF_PATH)
                log_handle.info(f"Loaded default scan_config for {lang_folder}: {list(scan_config.keys())}")
            except Exception as e:
                log_handle.warning(f"Failed to load default scan_config for language '{language}': {e}")

    # Merge crop settings (these override scan_config crop if both present)
    if crop_top > 0 or crop_bottom > 0 or crop_left > 0 or crop_right > 0:
        if "crop" not in scan_config:
            scan_config["crop"] = {}
        scan_config["crop"]["top"] = crop_top
        scan_config["crop"]["bottom"] = crop_bottom
        scan_config["crop"]["left"] = crop_left
        scan_config["crop"]["right"] = crop_right

    # Initialize PDF processor
    config = Config("configs/config.yaml")
    pdf_processor = AdvancedPDFProcessor(config)

    # --- Determine Image Source ---
    temp_path = None
    pil_image = None
    page_num = 1
    source_description = ""

    try:
        if relative_path and page_number:
            # Mode 1: Extract page directly from PDF in base folder
            base_pdf_folder = config.BASE_PDF_PATH
            pdf_file_path = os.path.join(base_pdf_folder, relative_path)
            if not pdf_file_path.endswith(".pdf"):
                pdf_file_path = f"{pdf_file_path}.pdf"

            if not os.path.exists(pdf_file_path):
                raise HTTPException(status_code=404, detail=f"PDF file not found: {relative_path}")

            log_handle.info(f"Extracting page {page_number} from {pdf_file_path}")

            # Use PDFProcessor._get_image to extract the specified page with cropping
            images, page_numbers = pdf_processor._get_image(pdf_file_path, [page_number], scan_config)
            if not images:
                raise HTTPException(status_code=400, detail=f"Failed to extract page {page_number} from PDF")

            pil_image = images[0]
            page_num = page_numbers[0]
            source_description = f"page {page_num} from {relative_path}"

        else:
            # Mode 2: Use uploaded image file
            suffix = '.pdf' if image.content_type == 'application/pdf' else '.png'

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                content = await image.read()
                temp_file.write(content)
                temp_path = temp_file.name

            if image.content_type == 'application/pdf':
                # Use PDFProcessor._get_image to extract first page with cropping
                images, page_numbers = pdf_processor._get_image(temp_path, [1], scan_config)
                if not images:
                    raise HTTPException(status_code=400, detail="Failed to extract page from PDF")

                pil_image = images[0]
                page_num = page_numbers[0]
            else:
                # Load image directly and apply cropping manually
                pil_image = Image.open(temp_path)

                # Apply cropping if needed (for non-PDF images)
                if crop_top > 0 or crop_bottom > 0 or crop_left > 0 or crop_right > 0:
                    width, height = pil_image.size
                    top_crop_pixels = int(height * crop_top / 100)
                    bottom_crop_pixels = int(height * crop_bottom / 100)
                    left_crop_pixels = int(width * crop_left / 100)
                    right_crop_pixels = int(width * crop_right / 100)
                    pil_image = pil_image.crop((left_crop_pixels, top_crop_pixels, width - right_crop_pixels, height - bottom_crop_pixels))

                page_num = 1

            source_description = f"uploaded file {image.filename}"

        # --- OCR via AdvancedPDFProcessor ---
        log_handle.info(f"Processing OCR for {source_description}...")
        tesseract_lang = language.replace(' ', '+')

        _, json_strings = AdvancedPDFProcessor._process_single_page(
            (page_num, pil_image, tesseract_lang, 6)
        )
        page_data = json.loads(json_strings[0])

        # --- Paragraph generation via AdvancedParagraphGenerator ---
        lang_code = "gu" if language.lower() in ("guj", "gu") else "hi"
        para_gen = AdvancedParagraphGenerator(config, get_language_meta(lang_code, scan_config))
        phase1 = para_gen._phase1_lines_to_typed_paragraphs([page_data], scan_config)
        typed_paragraphs = para_gen._phase2_combine_by_type(phase1)

        api_paragraphs = [
            Paragraph(text=text, boxes=[], paragraph_type=state.name)
            for _, text, state in typed_paragraphs
        ]
        extracted_text = '\n\n----\n\n'.join(p.text for p in api_paragraphs)
        log_handle.info(f"OCR processing completed: {len(api_paragraphs)} paragraphs")

        return OCRResponse(
            text=extracted_text,
            boxes=[],
            paragraphs=api_paragraphs,
            language=language,
            ocr_json=page_data,
            scan_config=scan_config,
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"OCR processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"OCR processing failed: {str(e)}")
    finally:
        # Clean up temporary files
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception as cleanup_error:
                log_handle.warning(f"Failed to cleanup temporary file: {cleanup_error}")

@router.post("/ocr/batch", response_model=BatchJobResponse)
async def start_batch_ocr(
    file: UploadFile = File(..., description="PDF file to process"),
    language: str = Form("hin", description="Language code for OCR (hin, guj, eng)"),
    use_google_ocr: bool = Form(False, description="Use Google Vision OCR instead of Tesseract"),
):
    """
    Start batch OCR processing of a PDF file.
    Returns a job ID for tracking progress.
    """
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    log_handle.info(f"Starting batch OCR for {file.filename} with language={language}")

    try:
        # Read file content upfront to avoid "read of closed file" error
        file_content = await file.read()

        ocr_service = get_ocr_service()
        job_id = ocr_service.start_batch_processing(file_content, language, use_google_ocr)

        return BatchJobResponse(job_id=job_id)

    except Exception as e:
        log_handle.error(f"Failed to start batch OCR: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to start batch processing: {str(e)}")

@router.get("/ocr/batch/status/{job_id}", response_model=BatchStatusResponse)
async def get_batch_status(job_id: str):
    """
    Get the status of a batch OCR job.
    """
    try:
        ocr_service = get_ocr_service()
        job_status = ocr_service.get_job_status(job_id)

        if not job_status:
            raise HTTPException(status_code=404, detail="Job not found")

        return BatchStatusResponse(
            status=job_status["status"],
            progress=job_status["progress"],
            total_pages=job_status["total_pages"],
            zip_filename=job_status.get("zip_filename"),
            error=job_status.get("error"),
            elapsed_time=job_status.get("elapsed_time"),
            elapsed_time_formatted=job_status.get("elapsed_time_formatted")
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error getting job status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting job status: {str(e)}")

@router.post("/ocr/batch/cancel/{job_id}")
async def cancel_batch_job(job_id: str):
    """
    Cancel a batch OCR job.
    """
    try:
        ocr_service = get_ocr_service()
        success = ocr_service.cancel_job(job_id)

        if not success:
            raise HTTPException(status_code=404, detail="Job not found or cannot be cancelled")

        return {"message": "Job cancellation requested"}

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error cancelling job: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error cancelling job: {str(e)}")

@router.get("/ocr/batch/download/{job_id}")
async def download_batch_results(job_id: str):
    """
    Download the results of a completed batch OCR job as a ZIP file.
    """
    try:
        ocr_service = get_ocr_service()
        zip_path = ocr_service.get_download_path(job_id)

        if not zip_path:
            raise HTTPException(status_code=404, detail="Download not available. Job may not be completed or file may have been cleaned up.")

        job_status = ocr_service.get_job_status(job_id)
        filename = job_status.get("zip_filename", f"extracted_text_{job_id}.zip")

        return FileResponse(
            path=zip_path,
            filename=filename,
            media_type="application/zip"
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error downloading results: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error downloading results: {str(e)}")

@router.post("/ocr/calculate-cost", response_model=CostCalculationResponse)
async def calculate_ocr_cost(request: CostCalculationRequest):
    """
    Calculate the cost of OCR processing.
    """
    try:
        ocr_service = get_ocr_service()
        cost_info = ocr_service.calculate_cost(request.total_pages, request.use_google_ocr)

        return CostCalculationResponse(**cost_info)

    except Exception as e:
        log_handle.error(f"Error calculating cost: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error calculating cost: {str(e)}")

# Background task to clean up old jobs
async def cleanup_old_jobs_task():
    """Background task to periodically clean up old jobs"""
    try:
        ocr_service = get_ocr_service()
        ocr_service.cleanup_old_jobs()
    except Exception as e:
        log_handle.error(f"Error during job cleanup: {str(e)}")

# Clean up old jobs when the module loads
import asyncio
try:
    asyncio.create_task(cleanup_old_jobs_task())
except Exception:
    pass  # Ignore if no event loop is running

@router.post("/bookmarks/extract", response_model=BookmarkExtractionResponse)
async def extract_bookmarks(request: BookmarkExtractionRequest):
    """
    Parse pravachan numbers, dates, and other fields from bookmark data using LLM.

    Bookmarks are extracted client-side (PDF.js) and sent as JSON.
    The backend only performs LLM parsing.

    Args:
        request: BookmarkExtractionRequest with bookmarks list and LLM provider

    Returns:
        BookmarkExtractionResponse with parsed bookmark data
    """
    try:
        if not request.bookmarks:
            raise HTTPException(status_code=400, detail="No bookmarks provided")

        log_handle.info(f"Parsing {len(request.bookmarks)} bookmarks using {request.llm_provider}")

        # Create extractor using factory
        try:
            extractor = create_bookmark_extractor_by_name(request.llm_provider)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Parse bookmarks using pre-extracted list (no PDF file needed).
        # Bookmarks are sent by the client (PDF.js); batch through call_llm directly.
        bookmarks = request.bookmarks
        batch_size = 100
        indexed_titles = [
            {"index": i, "page": item.get("page"), "title": item.get("title", "")}
            for i, item in enumerate(bookmarks)
        ]
        all_extracted_data = []
        total_batches = (len(indexed_titles) + batch_size - 1) // batch_size
        for batch_num in range(total_batches):
            batch = indexed_titles[batch_num * batch_size:(batch_num + 1) * batch_size]
            extracted = extractor.call_llm(batch)
            if not extracted:
                raise HTTPException(status_code=500, detail=f"LLM failed on batch {batch_num + 1}/{total_batches}")
            all_extracted_data.extend(extracted)
        bookmarks_data = extractor._merge_results(bookmarks, all_extracted_data)

        log_handle.info(f"Successfully parsed {len(bookmarks_data)} bookmarks")

        # Convert to response model
        bookmark_list = [
            BookmarkData(
                page=b['page'],
                level=b['level'],
                title=b['title'],
                pravachan_no=b.get('pravachan_no'),
                date=b.get('date'),
                gatha=b.get('gatha'),
                kalash=b.get('kalash'),
                shlok=b.get('shlok'),
                doha=b.get('doha'),
                kavya=b.get('kavya'),
                sutra=b.get('sutra'),
            )
            for b in bookmarks_data
        ]

        return BookmarkExtractionResponse(
            bookmarks=bookmark_list,
            total=len(bookmark_list),
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error parsing bookmarks: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error parsing bookmarks: {str(e)}")

@router.get("/pdf/proxy")
async def proxy_pdf(url: str):
    """
    Proxy PDF requests to avoid CORS issues with external PDF URLs.
    """
    try:
        # Validate that this is a PDF URL
        if not url or not (url.startswith('http://') or url.startswith('https://')):
            raise HTTPException(status_code=400, detail="Invalid URL provided")

        # Add some basic security - only allow certain domains if needed
        # For now, we'll be permissive but you can add domain whitelist here

        log_handle.info(f"Proxying PDF request for: {url}")

        # Make request to external PDF
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, timeout=30, stream=True)
        response.raise_for_status()

        # Check if it's actually a PDF
        content_type = response.headers.get('content-type', '').lower()
        if 'pdf' not in content_type and not url.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="URL does not appear to be a PDF file")

        # Return the PDF content with proper headers
        return Response(
            content=response.content,
            media_type="application/pdf",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "*",
                "Cache-Control": "public, max-age=3600"  # Cache for 1 hour
            }
        )

    except requests.RequestException as e:
        log_handle.error(f"Error fetching PDF from {url}: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch PDF: {str(e)}")
    except Exception as e:
        log_handle.error(f"Error proxying PDF: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error proxying PDF: {str(e)}")


@router.get("/file/proxy")
async def proxy_file(url: str):
    """
    Proxy file requests (PDF or image) to avoid CORS issues with external URLs.
    """
    try:
        if not url or not (url.startswith('http://') or url.startswith('https://')):
            raise HTTPException(status_code=400, detail="Invalid URL provided")

        log_handle.info(f"Proxying file request for: {url}")

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, timeout=30, stream=True)
        response.raise_for_status()

        content_type = response.headers.get('content-type', '').lower().split(';')[0].strip()
        url_path = url.lower().split('?')[0]

        if 'pdf' in content_type or url_path.endswith('.pdf'):
            media_type = 'application/pdf'
        elif content_type.startswith('image/'):
            media_type = content_type
        elif url_path.endswith(('.jpg', '.jpeg')):
            media_type = 'image/jpeg'
        elif url_path.endswith('.png'):
            media_type = 'image/png'
        elif url_path.endswith('.webp'):
            media_type = 'image/webp'
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")

        return Response(
            content=response.content,
            media_type=media_type,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "*",
                "Cache-Control": "no-store",
            }
        )

    except requests.RequestException as e:
        log_handle.error(f"Error fetching file from {url}: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch file: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error proxying file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error proxying file: {str(e)}")


@router.post("/ocr-preview", response_model=OCRPreviewResponse)
async def generate_ocr_preview(
    pdf_file: UploadFile = File(..., description="PDF file to preview"),
    crop_top: float = Form(0, description="Percentage to crop from top (0-50)"),
    crop_bottom: float = Form(0, description="Percentage to crop from bottom (0-50)"),
    crop_left: float = Form(0, description="Percentage to crop from left (0-50)"),
    crop_right: float = Form(0, description="Percentage to crop from right (0-50)"),
    offset: int = Form(0, description="Starting page number (0-indexed)"),
    limit: int = Form(50, description="Number of pages to preview (10-100)")
):
    """
    Generate preview images for PDF pages with cropping applied.
    """
    # Validate inputs
    if not (0 <= crop_top <= 50 and 0 <= crop_bottom <= 50 and 0 <= crop_left <= 50 and 0 <= crop_right <= 50):
        raise HTTPException(status_code=400, detail="Crop percentages must be between 0 and 50")

    if not (10 <= limit <= 100):
        raise HTTPException(status_code=400, detail="Limit must be between 10 and 100")

    if offset < 0:
        raise HTTPException(status_code=400, detail="Offset must be non-negative")

    if pdf_file.content_type != 'application/pdf':
        raise HTTPException(status_code=400, detail="File must be a PDF")

    temp_path = None

    try:
        # Save uploaded PDF to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_file:
            content = await pdf_file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        log_handle.info(f"Processing PDF preview for {pdf_file.filename}, offset={offset}, limit={limit}")

        # Initialize PDF processor
        config = Config("configs/config.yaml")
        pdf_processor = AdvancedPDFProcessor(config)

        # Build scan_config with crop settings
        scan_config = {}
        if crop_top > 0 or crop_bottom > 0 or crop_left > 0 or crop_right > 0:
            scan_config["crop"] = {
                "top": crop_top,
                "bottom": crop_bottom,
                "left": crop_left,
                "right": crop_right,
            }

        # Get total page count first
        import fitz  # PyMuPDF
        with fitz.open(temp_path) as doc:
            total_pages = len(doc)

        log_handle.info(f"PDF has {total_pages} pages")

        # Validate offset
        if offset >= total_pages:
            raise HTTPException(
                status_code=400,
                detail=f"Offset {offset} is beyond the last page (PDF has {total_pages} pages)"
            )

        # Calculate page range (1-indexed for PDFProcessor)
        start_page = offset + 1
        end_page = min(offset + limit, total_pages)
        page_numbers = list(range(start_page, end_page + 1))

        log_handle.info(f"Extracting pages {start_page} to {end_page}")

        # Extract images for the specified pages
        images, extracted_page_numbers = pdf_processor._get_image(temp_path, page_numbers, scan_config)

        if not images:
            raise HTTPException(status_code=400, detail="Failed to extract pages from PDF")

        # Convert images to base64
        preview_pages = []
        for img, page_num in zip(images, extracted_page_numbers):
            buffer = io.BytesIO()
            img.save(buffer, format='PNG')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

            preview_pages.append(PreviewPageData(
                page_number=page_num,
                image_data=image_base64
            ))

        log_handle.info(f"Successfully generated {len(preview_pages)} preview images")

        return OCRPreviewResponse(
            pages=preview_pages,
            total_pages=total_pages,
            offset=offset,
            limit=limit
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error generating PDF preview: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating preview: {str(e)}")
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception as e:
                log_handle.warning(f"Failed to delete temp file {temp_path}: {e}")


@router.post("/scripture-llm", response_model=ScriptureLLMResponse)
async def process_scripture_llm(
    image: UploadFile = File(..., description="PDF or image file to process"),
    page_number: int = Form(1, description="Page number to extract from PDF (1-indexed)"),
    language: str = Form("hin", description="Language code (hin, guj, eng)"),
    model_name: str = Form("gemini-2.5-flash", description="Gemini model to use"),
    crop_top: float = Form(0, description="Percentage to crop from top (0-50)"),
    crop_bottom: float = Form(0, description="Percentage to crop from bottom (0-50)"),
    crop_left: float = Form(0, description="Percentage to crop from left (0-50)"),
    crop_right: float = Form(0, description="Percentage to crop from right (0-50)"),
    use_default_scan_config: bool = Form(False, description="Load scan_config from Granth/<language>/"),
):
    """
    Process a scripture page using Gemini LLM for text extraction and categorisation.
    Accepts a PDF (extracts the specified page) or an image file.
    """
    if not (0 <= crop_top <= 50 and 0 <= crop_bottom <= 50 and 0 <= crop_left <= 50 and 0 <= crop_right <= 50):
        raise HTTPException(status_code=400, detail="Crop percentages must be between 0 and 50")

    if model_name not in LLM_ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Model must be one of: {LLM_ALLOWED_MODELS}")

    temp_path = None

    try:
        # Save uploaded file to temp
        is_pdf = image.content_type == 'application/pdf' or (image.filename and image.filename.lower().endswith('.pdf'))
        suffix = '.pdf' if is_pdf else '.png'

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            content = await image.read()
            temp_file.write(content)
            temp_path = temp_file.name

        # Build scan_config
        scan_config = _load_default_scan_config(language, "Granth") if use_default_scan_config else {}
        if crop_top > 0 or crop_bottom > 0 or crop_left > 0 or crop_right > 0:
            scan_config.setdefault("crop", {})
            scan_config["crop"]["top"] = crop_top
            scan_config["crop"]["bottom"] = crop_bottom
            scan_config["crop"]["left"] = crop_left
            scan_config["crop"]["right"] = crop_right

        if is_pdf:
            # Extract the specified page from PDF
            config = Config("configs/config.yaml")
            pdf_processor = AdvancedPDFProcessor(config)

            images, page_numbers = pdf_processor._get_image(temp_path, [page_number], scan_config)
            if not images:
                raise HTTPException(status_code=400, detail=f"Failed to extract page {page_number} from PDF")

            pil_image = images[0]
        else:
            # Load image directly and apply cropping
            pil_image = Image.open(temp_path)

            if crop_top > 0 or crop_bottom > 0 or crop_left > 0 or crop_right > 0:
                width, height = pil_image.size
                top_px = int(height * crop_top / 100)
                bottom_px = int(height * crop_bottom / 100)
                left_px = int(width * crop_left / 100)
                right_px = int(width * crop_right / 100)
                pil_image = pil_image.crop((left_px, top_px, width - right_px, height - bottom_px))

        # Generate base64 preview of the cropped image
        buffer = io.BytesIO()
        pil_image.save(buffer, format='PNG')
        buffer.seek(0)
        preview_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

        # Call LLM extractor
        log_handle.info(f"Calling LLM extractor: model={model_name}, language={language}")
        blocks = extract_indic_text_any(pil_image, model_name)

        return ScriptureLLMResponse(
            blocks=[ScriptureLLMTextBlock(**b) for b in blocks],
            model=model_name,
            language=language,
            preview_image=preview_base64,
            scan_config=scan_config if scan_config else None,
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Scripture LLM processing failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Scripture LLM processing failed: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception as cleanup_error:
                log_handle.warning(f"Failed to cleanup temp file: {cleanup_error}")


# --- Paragraph Classifier Helpers ---

def _classifier_scan_cfg(config, ocr_relative_path: str) -> dict:
    """Walk up the PDF tree from ocr_relative_path to find + flatten scan_config.json.

    Merges the 'default' section with the document-specific section (keyed by the
    document name, i.e. the last component of ocr_relative_path).  Document-specific
    keys take precedence, so fields like book_start_side/book_start_page are returned
    correctly even when they live outside the 'default' block.
    """
    doc_name = os.path.basename(ocr_relative_path)
    search_dir = os.path.join(config.BASE_PDF_PATH, ocr_relative_path)
    while True:
        candidate = os.path.join(search_dir, "scan_config.json")
        if os.path.isfile(candidate):
            with open(candidate, encoding="utf-8") as fh:
                raw = json.load(fh)
            merged = {**raw.get("default", {}), **raw.get(doc_name, {})}
            return merged if merged else raw
        parent = os.path.dirname(search_dir)
        if parent == search_dir:
            break
        search_dir = parent
    return {}


def _classifier_pdf_path(config, ocr_relative_path: str) -> str:
    """Return the full PDF file path for a given ocr_relative_path."""
    return os.path.join(config.BASE_PDF_PATH, ocr_relative_path + ".pdf")


def _classifier_ocr_dir(config, ocr_relative_path: str) -> str:
    return os.path.join(config.BASE_OCR_PATH, ocr_relative_path)


def _load_page_mapping(ocr_dir: str) -> Optional[Dict[str, int]]:
    """Return logical→physical dict from page_mapping.json, or None if not present."""
    path = os.path.join(ocr_dir, "page_mapping.json")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return {k: int(v) for k, v in raw.items()}


# --- Paragraph Classifier Models ---

class ClassifierBlock(BaseModel):
    type: str
    text: str

class ClassifierPageResponse(BaseModel):
    page: int
    blocks: List[ClassifierBlock]
    ocr_relative_path: str

class ClassifierSaveRequest(BaseModel):
    ocr_relative_path: str
    page: int
    blocks: List[ClassifierBlock]

class ClassifierSaveResponse(BaseModel):
    saved: bool
    backup_path: str
    message: str

class ClassifierPageMappingResponse(BaseModel):
    # logical_page (str key) -> physical_pdf_page (int)
    # None when this is a single-page PDF (no page_mapping.json)
    page_mapping: Optional[Dict[str, int]]
    split_percentage: int
    book_start_side: str        # "left" or "right"
    available_pages: List[int]  # sorted list of logical pages that have a page_XXXX.json file

class ClassifierBookmark(BaseModel):
    title: str
    level: int
    logical_page: int           # already resolved; jump straight to this page

class ClassifierBookmarksResponse(BaseModel):
    bookmarks: List[ClassifierBookmark]


# --- Paragraph Classifier Endpoints ---

@router.get("/classifier/block-types")
async def get_block_types():
    """Return the canonical list of LLM block types."""
    return {"block_types": BLOCK_TYPES}


@router.get("/pdf/page-mapping", response_model=ClassifierPageMappingResponse)
async def get_page_mapping(ocr_relative_path: str):
    """
    Return multi-page PDF metadata for the given OCR directory:
      - page_mapping: logical_page -> physical_pdf_page (None if single-page PDF)
      - split_percentage, book_start_side: from scan_config
      - available_pages: sorted logical pages that have a page_XXXX.json file
    """
    try:
        config = Config("configs/config.yaml")
        ocr_dir = _classifier_ocr_dir(config, ocr_relative_path)

        if not os.path.isdir(ocr_dir):
            raise HTTPException(status_code=404, detail=f"OCR directory not found: {ocr_relative_path}")

        import re as _re
        page_mapping = _load_page_mapping(ocr_dir)
        scan_cfg = _classifier_scan_cfg(config, ocr_relative_path)

        # Always derive available pages from the JSON files present on disk.
        # page_mapping only covers the multi-page split portion; single-page OCR'd
        # pages (not in the mapping) are equally valid and must be included.
        available_pages = sorted(
            int(m.group(1))
            for f in os.listdir(ocr_dir)
            if (m := _re.match(r"^page_(\d{4})\.json$", f))
        )

        return ClassifierPageMappingResponse(
            page_mapping=page_mapping,
            split_percentage=int(scan_cfg.get("split_percentage", 50)),
            book_start_side=scan_cfg.get("book_start_side", "left"),
            available_pages=available_pages,
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error loading page mapping: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error loading page mapping: {str(e)}")


@router.get("/pdf/bookmarks", response_model=ClassifierBookmarksResponse)
async def get_classifier_bookmarks(ocr_relative_path: str):
    """
    Extract bookmarks from the PDF and return them with logical page numbers.

    For multi-page PDFs the physical page from the PDF outline is looked up in
    page_mapping to resolve the corresponding logical page.  For single-page PDFs
    the physical and logical page numbers are identical.
    """
    try:
        config = Config("configs/config.yaml")
        pdf_path = _classifier_pdf_path(config, ocr_relative_path)

        if not os.path.isfile(pdf_path):
            raise HTTPException(status_code=404, detail=f"PDF not found: {ocr_relative_path}.pdf")

        import fitz  # PyMuPDF — already available

        ocr_dir = _classifier_ocr_dir(config, ocr_relative_path)
        page_mapping = _load_page_mapping(ocr_dir) if os.path.isdir(ocr_dir) else None

        # Build reverse map: physical_page -> list of logical pages
        # (a physical page can map to two logical pages in a multi-page PDF)
        physical_to_logical: Dict[int, List[int]] = {}
        if page_mapping:
            for logical_str, physical in page_mapping.items():
                physical_to_logical.setdefault(physical, []).append(int(logical_str))
            for v in physical_to_logical.values():
                v.sort()

        bookmarks: List[ClassifierBookmark] = []
        with fitz.open(pdf_path) as doc:
            toc = doc.get_toc(simple=True)  # [(level, title, page_1indexed), ...]
            for level, title, physical_page in toc:
                if page_mapping:
                    # Use the first (lowest) logical page on that physical page
                    logical_pages = physical_to_logical.get(physical_page, [])
                    logical_page = logical_pages[0] if logical_pages else physical_page
                else:
                    logical_page = physical_page
                bookmarks.append(ClassifierBookmark(
                    title=title,
                    level=level,
                    logical_page=logical_page,
                ))

        return ClassifierBookmarksResponse(bookmarks=bookmarks)

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error extracting bookmarks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error extracting bookmarks: {str(e)}")


@router.get("/pdf/parsed-bookmarks")
async def get_parsed_bookmarks(ocr_relative_path: str):
    """
    Return the parsed bookmark metadata stored in index_state for this document.
    These are LLM-extracted fields (pravachan_no, date, gatha, etc.) per bookmark page.
    """
    try:
        config = Config("configs/config.yaml")
        db_path = config.SQLITE_DB_PATH

        if not db_path or not os.path.isfile(db_path):
            return {"bookmarks": []}

        relative_path = ocr_relative_path + ".pdf"
        doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_path))

        index_state = IndexState(db_path)
        state = index_state.get_state(doc_id)

        raw = state.get("parsed_bookmarks")
        if not raw:
            return {"bookmarks": []}

        bookmarks = json.loads(raw) if isinstance(raw, str) else raw
        return {"bookmarks": bookmarks}

    except Exception as e:
        log_handle.error(f"Error fetching parsed bookmarks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error fetching parsed bookmarks: {str(e)}")


@router.get("/pdf/page-image")
async def get_classifier_page_image(ocr_relative_path: str, logical_page: int):
    """
    Render the PDF page corresponding to the given logical page number and return
    it as a base64-encoded PNG.

    For multi-page PDFs:
      - Looks up the physical page from page_mapping.json
      - Determines which half (left/right) belongs to this logical page using
        split_percentage and book_start_side from scan_config
      - Returns only that half as the image

    For single-page PDFs:
      - logical_page == physical page; returns the full page image
    """
    try:
        config = Config("configs/config.yaml")
        pdf_path = _classifier_pdf_path(config, ocr_relative_path)

        if not os.path.isfile(pdf_path):
            raise HTTPException(status_code=404, detail=f"PDF not found: {ocr_relative_path}.pdf")

        ocr_dir = _classifier_ocr_dir(config, ocr_relative_path)
        page_mapping = _load_page_mapping(ocr_dir) if os.path.isdir(ocr_dir) else None
        scan_cfg = _classifier_scan_cfg(config, ocr_relative_path)

        split_pct = int(scan_cfg.get("split_percentage", 50))
        book_start_side = scan_cfg.get("book_start_side", "left")

        import fitz

        # A page_mapping may only cover a subset of logical pages (e.g. the multi-page
        # portion of a mixed PDF).  Fall back to full-page mode for any page that is
        # absent from the mapping — logical == physical, no cropping needed.
        mapped_physical = page_mapping.get(str(logical_page)) if page_mapping else None

        if mapped_physical is not None:
            physical_page = mapped_physical
            # Determine which half this logical page occupies.
            # book_start_side="left":  odd logical → left,  even logical → right
            # book_start_side="right": odd logical → right, even logical → left
            is_odd = (logical_page % 2 == 1)
            if book_start_side == "left":
                side = "left" if is_odd else "right"
            else:
                side = "right" if is_odd else "left"
        else:
            physical_page = logical_page
            side = None  # full page — single-page OCR or page not in mapping

        with fitz.open(pdf_path) as doc:
            if physical_page < 1 or physical_page > len(doc):
                raise HTTPException(
                    status_code=404,
                    detail=f"Physical page {physical_page} out of range (PDF has {len(doc)} pages)"
                )
            page = doc[physical_page - 1]  # 0-indexed
            mat = fitz.Matrix(2.0, 2.0)    # 2× render for sharpness
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        if side is not None:
            w, h = img.size
            split_x = int(w * split_pct / 100)
            if side == "left":
                img = img.crop((0, 0, split_x, h))
            else:
                img = img.crop((split_x, 0, w, h))

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        image_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        return {"image": image_b64, "physical_page": physical_page, "side": side}

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error rendering page image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error rendering page: {str(e)}")


@router.get("/classifier/page", response_model=ClassifierPageResponse)
async def get_classifier_page(ocr_relative_path: str, page: int):
    """Load page_XXXX.json from the OCR directory, validating ocr_engine=llm."""
    try:
        config = Config("configs/config.yaml")
        ocr_dir = _classifier_ocr_dir(config, ocr_relative_path)

        if not os.path.isdir(ocr_dir):
            raise HTTPException(status_code=404, detail=f"OCR directory not found: {ocr_relative_path}")

        scan_cfg = _classifier_scan_cfg(config, ocr_relative_path)
        ocr_engine = scan_cfg.get("ocr_engine", "")
        if ocr_engine != "llm":
            raise HTTPException(
                status_code=400,
                detail=f"scan_config.json has ocr_engine='{ocr_engine}', expected 'llm'."
            )

        page_file = os.path.join(ocr_dir, f"page_{page:04d}.json")
        if not os.path.isfile(page_file):
            raise HTTPException(status_code=404, detail=f"Page file not found: page_{page:04d}.json")

        with open(page_file, encoding="utf-8") as fh:
            blocks = json.load(fh)

        return ClassifierPageResponse(
            page=page,
            blocks=[ClassifierBlock(**b) for b in blocks],
            ocr_relative_path=ocr_relative_path,
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error loading classifier page: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error loading page: {str(e)}")


@router.post("/classifier/save", response_model=ClassifierSaveResponse)
async def save_classifier_page(request: ClassifierSaveRequest):
    """
    Save corrected block classifications back to page_XXXX.json.
    Creates a .bak backup of the original file first.
    Validates that scan_config has ocr_engine=llm before writing.
    """
    try:
        config = Config("configs/config.yaml")
        ocr_dir = _classifier_ocr_dir(config, request.ocr_relative_path)

        if not os.path.isdir(ocr_dir):
            raise HTTPException(status_code=404, detail=f"OCR directory not found: {request.ocr_relative_path}")

        scan_cfg = _classifier_scan_cfg(config, request.ocr_relative_path)
        ocr_engine = scan_cfg.get("ocr_engine", "")
        if ocr_engine != "llm":
            raise HTTPException(
                status_code=400,
                detail=f"scan_config.json has ocr_engine='{ocr_engine}', expected 'llm'."
            )

        page_file = os.path.join(ocr_dir, f"page_{request.page:04d}.json")
        if not os.path.isfile(page_file):
            raise HTTPException(status_code=404, detail=f"Page file not found: page_{request.page:04d}.json")

        backup_path = page_file + ".bak"
        if not os.path.isfile(backup_path):
            shutil.copy2(page_file, backup_path)
            log_handle.info(f"Created backup: {backup_path}")

        corrected = [{"type": b.type, "text": b.text} for b in request.blocks]
        with open(page_file, "w", encoding="utf-8") as fh:
            json.dump(corrected, fh, ensure_ascii=False, indent=2)

        log_handle.info(f"Saved classifier corrections to {page_file}")

        return ClassifierSaveResponse(
            saved=True,
            backup_path=os.path.relpath(backup_path, config.BASE_OCR_PATH),
            message=f"Saved page {request.page}. Backup at {os.path.basename(backup_path)}.",
        )

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error saving classifier page: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error saving page: {str(e)}")


# --- Standalone Eval App ---
# Run with: uvicorn eval.api:app --host 0.0.0.0 --port 8001 --env-file .env.local
# ---------------------------------------------------------------------------
# Unindexed PDFs helpers
# ---------------------------------------------------------------------------

def _config_hash(config_data: dict) -> str:
    """Identical to SingleFileProcessor._get_config_hash in discovery.py."""
    return hashlib.sha256(json_dumps(config_data, sort_keys=True).encode('utf-8')).hexdigest()


def _classify_index_status(state: dict, current_config_hash: str) -> str:
    """Map a DB state row to a status string by comparing stored vs current config_hash."""
    if not state:
        return "never_indexed"
    stored_config_hash = state.get("config_hash")
    ocr_checksum = state.get("ocr_checksum")
    if not stored_config_hash:
        return "ocr_only" if ocr_checksum else "never_indexed"
    if stored_config_hash != current_config_hash:
        return "stale"
    return "indexed"


def _walk_pdfs(base_pdf_path: str):
    """Yield absolute PDF file paths, respecting _ignore markers."""
    for dirpath, dirnames, filenames in os.walk(base_pdf_path):
        # Prune ignored and hidden dirs in-place
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.startswith(".")
            and not os.path.exists(os.path.join(dirpath, d, "_ignore"))
        )
        if os.path.exists(os.path.join(dirpath, "_ignore")):
            dirnames.clear()
            continue
        for fn in filenames:
            if fn.lower().endswith(".pdf"):
                yield os.path.join(dirpath, fn)


def _get_terminal_scan_config_dir(file_path: str, base_pdf_path: str) -> str:
    """
    Return relative path of the deepest directory (closest to file_path) that
    contains a scan_config.json.  This is the 'terminal' scan_config for the file.
    Falls back to "" if none found.
    """
    current = os.path.dirname(file_path)
    while True:
        if os.path.exists(os.path.join(current, "scan_config.json")):
            return os.path.relpath(current, base_pdf_path)
        if os.path.samefile(current, base_pdf_path):
            break
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return ""


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/unindexed-pdfs")
async def get_unindexed_pdfs():
    """
    Scan BASE_PDF_PATH for all PDFs and report which are unindexed, OCR-only, or stale.
    Results are grouped by category, then by terminal scan_config.json directory.
    Each scan_config group includes all PDFs under it (indexed + non-indexed) so the
    UI can show context counts; groups where every PDF is indexed are omitted.
    """
    config = Config("configs/config.yaml")
    base_pdf_path = config.BASE_PDF_PATH
    db_path = config.SQLITE_DB_PATH

    if not base_pdf_path or not os.path.isdir(base_pdf_path):
        raise HTTPException(status_code=500, detail="BASE_PDF_PATH not configured or missing")
    if not db_path or not os.path.isfile(db_path):
        raise HTTPException(status_code=500, detail="SQLITE_DB_PATH not configured or DB missing")

    index_state = IndexState(db_path)
    all_states = index_state.load_state()

    status_order = {"never_indexed": 0, "stale": 1, "ocr_only": 2, "indexed": 3}

    # groups[category][scan_config_dir] = [pdf_item, ...]
    groups: Dict[str, Dict[str, List]] = {}
    seen_paths: set = set()

    for file_path in _walk_pdfs(base_pdf_path):
        relative_path = os.path.relpath(file_path, base_pdf_path)
        if relative_path in seen_paths:
            continue
        seen_paths.add(relative_path)
        filename = os.path.basename(file_path)

        metadata = get_merged_config(file_path, base_pdf_path)
        category = metadata.get("category", "Uncategorised")
        scan_cfg = get_scan_config(file_path, base_pdf_path)
        sub_sections = scan_cfg.get("sub_sections", [])
        file_metadata = dict(metadata)
        file_metadata["file_url"] = scan_cfg.get("file_url", "")
        if "volume" in scan_cfg:
            file_metadata["volume"] = scan_cfg["volume"]

        scan_config_dir = _get_terminal_scan_config_dir(file_path, base_pdf_path)

        if sub_sections:
            # Check base file OCR state — used to promote "never_indexed" → "ocr_only"
            # for sub-sections when OCR has been run but sub-sections haven't been indexed yet.
            base_doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_path))
            base_ocr_done = bool(all_states.get(base_doc_id, {}).get("ocr_checksum"))

            ss_rows = []
            for ss in sub_sections:
                field = ss.get("field", "")
                name = ss.get("name", "")
                sub_key = f"{field}:{name}"
                doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{relative_path}#{sub_key}"))
                state = all_states.get(doc_id, {})
                sub_config_hash = _config_hash({**file_metadata, "sub_section": {"field": field, "name": name}})
                status = _classify_index_status(state, sub_config_hash)
                if status == "never_indexed" and base_ocr_done:
                    status = "ocr_only"
                ss_rows.append({"name": name, "status": status})

            worst = min(ss_rows, key=lambda s: status_order.get(s["status"], 9))
            pdf_item = {
                "filename": filename,
                "relative_path": relative_path,
                "sub_sections": ss_rows,
                "status": worst["status"],
                "last_indexed": None,
            }
        else:
            doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_path))
            state = all_states.get(doc_id, {})
            status = _classify_index_status(state, _config_hash(file_metadata))
            pdf_item = {
                "filename": filename,
                "relative_path": relative_path,
                "sub_sections": None,
                "status": status,
                "last_indexed": state.get("last_indexed_timestamp"),
            }

        groups.setdefault(category, {}).setdefault(scan_config_dir, []).append(pdf_item)

    # Build result: emit only groups that have at least one non-indexed PDF
    result: Dict[str, List] = {}
    for category, dir_groups in groups.items():
        for scan_config_dir, pdfs in dir_groups.items():
            if all(p["status"] == "indexed" for p in pdfs):
                continue
            worst_status = min(pdfs, key=lambda p: status_order.get(p["status"], 9))["status"]
            pdfs_sorted = sorted(pdfs, key=lambda p: (status_order.get(p["status"], 9), p["filename"]))
            result.setdefault(category, []).append({
                "scan_config_dir": scan_config_dir,
                "worst_status": worst_status,
                "pdfs": pdfs_sorted,
            })

    for cat in result:
        result[cat].sort(key=lambda g: (status_order.get(g["worst_status"], 9), g["scan_config_dir"]))

    return result


app = FastAPI(title="Catalogue Eval UI", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")

from eval.load_test.api import router as load_test_router  # noqa: E402
from eval.load_test import db as load_test_db              # noqa: E402
app.include_router(load_test_router, prefix="/api")

@app.on_event("startup")
async def startup():
    load_test_db.init_db()
    logs_dir = os.environ.get("LOGS_DIR", "logs")
    setup_logging(
        logs_dir=logs_dir, console_level=VERBOSE_LEVEL_NUM,
        file_level=VERBOSE_LEVEL_NUM,
        console_only=False)
    log_handle.info("Eval app started.")
