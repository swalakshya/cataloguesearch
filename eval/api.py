from fastapi import APIRouter, FastAPI, HTTPException, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from utils.logger import setup_logging, VERBOSE_LEVEL_NUM
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import os
import sys
import tempfile
import logging
import time
import psutil
import uuid
import zipfile
import shutil
import concurrent.futures
import threading
import requests
from enum import Enum
import base64
import io

# OCR-specific imports
from PIL import Image

from backend.config import Config
from backend.crawler.pdf_processor import PDFProcessor
from backend.crawler.markdown_parser import MarkdownParser
from backend.common.scan_config import get_scan_config
from backend.crawler.bookmark_extractor.factory import create_bookmark_extractor_by_name
from backend.crawler.llm_shastra_extractor.llm_extractor import extract_indic_text
from .ocr import get_ocr_service
from scratch.para_gen.para_gen import process_image_to_paragraphs

log_handle = logging.getLogger(__name__)

# --- Language mapping for PDFProcessor compatibility ---
def get_pdf_processor_language(api_language: str) -> str:
    """Convert API language codes to PDFProcessor language codes"""
    language_map = {"hin": "hi", "guj": "gu", "eng": "en"}
    return language_map.get(api_language, "hi")

class OCRMode(str, Enum):
    """Defines the available OCR processing modes."""
    PSM6 = "psm6"
    PSM3 = "psm3"
    ADVANCED = "advanced"

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

class OCRResponse(BaseModel):
    text: str
    boxes: List[TextBox]
    paragraphs: List[Paragraph]
    language: str

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

# --- Scripture Eval Request Model ---
class ScriptureEvalRequest(BaseModel):
    relative_path: str

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

@router.post("/ocr", response_model=OCRResponse)
async def process_ocr(
    image: UploadFile = File(None, description="Image file to process (not needed if relative_path and page_number are provided)"),
    language: str = Form("hin", description="Language code for OCR (hin, guj, eng)"),
    crop_top: float = Form(0, description="Percentage to crop from top (0-50)"),
    crop_bottom: float = Form(0, description="Percentage to crop from bottom (0-50)"),
    mode: OCRMode = Form(
        OCRMode.PSM6,
        description='OCR processing mode. "psm6" and "psm3" use the legacy processor. '
                    '"advanced" uses the new para_gen logic (beta).'
    ),
    relative_path: Optional[str] = Form(None, description="Relative path to PDF file from base folder"),
    page_number: Optional[int] = Form(None, description="Page number to extract from PDF (1-indexed, requires relative_path)")
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
    if not (0 <= crop_top <= 50 and 0 <= crop_bottom <= 50):
        raise HTTPException(status_code=400, detail="Crop percentages must be between 0 and 50")

    # Determine settings based on the selected mode
    use_para_gen = (mode == OCRMode.ADVANCED)
    psm = 3 if mode == OCRMode.PSM3 else 6

    # For now, Google OCR is not supported with this endpoint.
    use_google_ocr = False

    # TODO: Google OCR not yet supported in PDFProcessor integration
    if use_google_ocr:
        raise HTTPException(status_code=400, detail="Google OCR is not supported for single-page evaluation.")

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

    # Merge crop settings (these override scan_config crop if both present)
    if crop_top > 0 or crop_bottom > 0:
        if "crop" not in scan_config:
            scan_config["crop"] = {}
        scan_config["crop"]["top"] = crop_top
        scan_config["crop"]["bottom"] = crop_bottom

    # Map language to PDFProcessor format
    processor_language = get_pdf_processor_language(language)

    # Initialize PDF processor
    config = Config("configs/config.yaml")
    pdf_processor = PDFProcessor(config)

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
                if crop_top > 0 or crop_bottom > 0:
                    width, height = pil_image.size
                    top_crop_pixels = int(height * crop_top / 100)
                    bottom_crop_pixels = int(height * crop_bottom / 100)
                    pil_image = pil_image.crop((0, top_crop_pixels, width, height - bottom_crop_pixels))

                page_num = 1

            source_description = f"uploaded file {image.filename}"

        # --- OCR and Paragraph Logic ---
        if use_para_gen:
            log_handle.info(f"Processing OCR for {source_description} using para_gen logic...")
            # Map language to pytesseract format ('hin+guj')
            tesseract_lang = language.replace(' ', '+')

            # Call the new refactored function with scan_config
            generated_paragraphs, _ = process_image_to_paragraphs(
                pil_image, lang=tesseract_lang, page_num=page_num, scan_config=scan_config
            )

            # Adapt the output to the API's Paragraph model
            api_paragraphs = [Paragraph(text=p.text, boxes=[]) for p in generated_paragraphs]
            extracted_text = '\n\n----\n\n'.join([p.text for p in api_paragraphs])
            log_handle.info(f"OCR processing completed using para_gen: {len(api_paragraphs)} paragraphs")

            return OCRResponse(text=extracted_text, boxes=[], paragraphs=api_paragraphs, language=language)

        else: # Keep the original logic
            log_handle.info(f"Processing OCR for {source_description} using legacy PDFProcessor logic...")
            config = Config("configs/config.yaml")
            pdf_processor = PDFProcessor(config)
            processor_language = get_pdf_processor_language(language)

            # Use PDFProcessor._process_single_page for OCR
            processor_lang_code = pdf_processor._pytesseract_language_map[processor_language]
            _, text_paragraphs = PDFProcessor._process_single_page(
                (page_num, pil_image, processor_lang_code, psm))

            # Create paragraphs without text boxes (simplified approach)
            paragraphs = [Paragraph(text=p_text, boxes=[]) for p_text in text_paragraphs]
            extracted_text = '\n\n----\n\n'.join([p.text for p in paragraphs])
            log_handle.info(f"OCR processing completed using PDFProcessor: {len(paragraphs)} paragraphs")

            return OCRResponse(text=extracted_text, boxes=[], paragraphs=paragraphs, language=language)

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
    psm: int = Form(6, description="PSM mode (3 or 6)")
):
    """
    Start batch OCR processing of a PDF file.
    Returns a job ID for tracking progress.
    """
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    # Validate PSM value
    if psm not in [3, 6]:
        raise HTTPException(status_code=400, detail="PSM must be 3 or 6")

    log_handle.info(f"Starting batch OCR for {file.filename} with language={language}")

    try:
        # Read file content upfront to avoid "read of closed file" error
        file_content = await file.read()

        ocr_service = get_ocr_service()
        job_id = ocr_service.start_batch_processing(file_content, language, use_google_ocr, psm)

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

@router.post("/scripture")
async def process_scripture(request: ScriptureEvalRequest):
    """
    Process a markdown scripture file and return the parsed Granth object.
    """
    try:
        # Initialize config to get base paths
        config = Config("configs/config.yaml")

        # Construct the full path to the markdown file
        # Assuming the relative path is relative to the base markdown directory
        base_path = getattr(config, 'BASE_MARKDOWN_PATH', config.BASE_PDF_PATH)  # fallback to PDF path if markdown path not defined
        full_file_path = os.path.join(base_path, request.relative_path)

        # Validate file exists and is a markdown file
        if not os.path.exists(full_file_path):
            raise HTTPException(status_code=404, detail=f"Markdown file not found: {request.relative_path}")

        if not full_file_path.lower().endswith('.md'):
            raise HTTPException(status_code=400, detail="File must be a markdown (.md) file")

        log_handle.info(f"Processing scripture file: {full_file_path}")

        # Parse the markdown file using MarkdownParser
        # Pass the base directory so it can find config files
        parser = MarkdownParser(base_folder=base_path)
        granth = parser.parse_file(full_file_path)

        log_handle.info(f"Successfully parsed Granth: {granth._name} with {len(granth._verses)} verses")

        # Return the Granth object as HTTP response
        return granth.get_http_response()

    except HTTPException:
        raise
    except Exception as e:
        log_handle.error(f"Error processing scripture file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing scripture file: {str(e)}")

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

        # Parse bookmarks using pre-extracted list (no PDF file needed)
        bookmarks_data = extractor.parse_bookmarks_from_list(request.bookmarks)

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


@router.post("/ocr-preview", response_model=OCRPreviewResponse)
async def generate_ocr_preview(
    pdf_file: UploadFile = File(..., description="PDF file to preview"),
    crop_top: float = Form(0, description="Percentage to crop from top (0-50)"),
    crop_bottom: float = Form(0, description="Percentage to crop from bottom (0-50)"),
    offset: int = Form(0, description="Starting page number (0-indexed)"),
    limit: int = Form(50, description="Number of pages to preview (10-100)")
):
    """
    Generate preview images for PDF pages with cropping applied.
    """
    # Validate inputs
    if not (0 <= crop_top <= 50 and 0 <= crop_bottom <= 50):
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
        pdf_processor = PDFProcessor(config)

        # Build scan_config with crop settings
        scan_config = {}
        if crop_top > 0 or crop_bottom > 0:
            scan_config["crop"] = {
                "top": crop_top,
                "bottom": crop_bottom
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
):
    """
    Process a scripture page using Gemini LLM for text extraction and categorisation.
    Accepts a PDF (extracts the specified page) or an image file.
    """
    if not (0 <= crop_top <= 50 and 0 <= crop_bottom <= 50):
        raise HTTPException(status_code=400, detail="Crop percentages must be between 0 and 50")

    allowed_models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"]
    if model_name not in allowed_models:
        raise HTTPException(status_code=400, detail=f"Model must be one of: {allowed_models}")

    temp_path = None

    try:
        # Save uploaded file to temp
        is_pdf = image.content_type == 'application/pdf' or (image.filename and image.filename.lower().endswith('.pdf'))
        suffix = '.pdf' if is_pdf else '.png'

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            content = await image.read()
            temp_file.write(content)
            temp_path = temp_file.name

        # Build scan_config for cropping
        scan_config = {}
        if crop_top > 0 or crop_bottom > 0:
            scan_config["crop"] = {"top": crop_top, "bottom": crop_bottom}

        if is_pdf:
            # Extract the specified page from PDF
            config = Config("configs/config.yaml")
            pdf_processor = PDFProcessor(config)

            images, page_numbers = pdf_processor._get_image(temp_path, [page_number], scan_config)
            if not images:
                raise HTTPException(status_code=400, detail=f"Failed to extract page {page_number} from PDF")

            pil_image = images[0]
        else:
            # Load image directly and apply cropping
            pil_image = Image.open(temp_path)

            if crop_top > 0 or crop_bottom > 0:
                width, height = pil_image.size
                top_px = int(height * crop_top / 100)
                bottom_px = int(height * crop_bottom / 100)
                pil_image = pil_image.crop((0, top_px, width, height - bottom_px))

        # Generate base64 preview of the cropped image
        buffer = io.BytesIO()
        pil_image.save(buffer, format='PNG')
        buffer.seek(0)
        preview_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

        # Call LLM extractor
        log_handle.info(f"Calling LLM extractor: model={model_name}, language={language}")
        blocks = extract_indic_text(pil_image, model_name=model_name)

        return ScriptureLLMResponse(
            blocks=[ScriptureLLMTextBlock(**b) for b in blocks],
            model=model_name,
            language=language,
            preview_image=preview_base64,
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


# --- Standalone Eval App ---
# Run with: uvicorn eval.api:app --host 0.0.0.0 --port 8000 --env-file .env.local
app = FastAPI(title="Catalogue Eval UI", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")

@app.on_event("startup")
async def startup():
    logs_dir = os.environ.get("LOGS_DIR", "logs")
    setup_logging(
        logs_dir=logs_dir, console_level=VERBOSE_LEVEL_NUM,
        file_level=VERBOSE_LEVEL_NUM,
        console_only=False)
    log_handle.info("Eval app started.")