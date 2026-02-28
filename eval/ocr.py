"""
OCR Service for Evaluation Module

This module provides OCR functionality for the evaluation system using:
- AdvancedPDFProcessor from backend/crawler/advanced_pdf_processor.py for PDF-to-image extraction
- process_image_to_paragraphs from scratch/para_gen/para_gen.py for OCR and paragraph detection
- Job management and batch processing logic for concurrent PDF processing
"""

import os
import sys
import tempfile
import logging
import time
import threading
import concurrent.futures
import zipfile
import shutil
import uuid
from typing import Dict, List, Optional, Tuple

# Add backend directory to path for PDFProcessor import
backend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backend')
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.config import Config
from scratch.para_gen.para_gen import process_image_to_paragraphs

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Job Management (copied from ocr_utils) ---

class EvalJobManager:
    """Manages OCR jobs for the evaluation system"""
    
    def __init__(self):
        self.jobs: Dict[str, Dict] = {}
        self.lock = threading.Lock()
        self.job_semaphore = threading.Semaphore(2)  # Allow 2 concurrent jobs
        
    def create_job(self, job_type: str = "batch_ocr") -> str:
        """Create a new job and return job ID"""
        job_id = str(uuid.uuid4())
        
        with self.lock:
            self.jobs[job_id] = {
                "id": job_id,
                "type": job_type,
                "status": "queued",
                "progress": 0,
                "total_pages": 0,
                "created_at": time.time(),
                "updated_at": time.time(),
                "output_dir": None,
                "zip_filename": None,
                "error": None,
                "cancel_requested": False
            }
            
        logger.info(f"Created job {job_id}")
        return job_id
    
    def update_job_status(self, job_id: str, status: str, **kwargs):
        """Update job status and other properties"""
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id]["status"] = status
                self.jobs[job_id]["updated_at"] = time.time()
                
                for key, value in kwargs.items():
                    self.jobs[job_id][key] = value
                    
                logger.debug(f"Job {job_id} updated: {status}")
    
    def update_job_progress(self, job_id: str, progress: int):
        """Update job progress"""
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id]["progress"] = progress
                self.jobs[job_id]["updated_at"] = time.time()
    
    def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get job status"""
        with self.lock:
            return self.jobs.get(job_id, None)
    
    def request_job_cancellation(self, job_id: str) -> bool:
        """Request job cancellation"""
        with self.lock:
            if job_id in self.jobs and self.jobs[job_id]["status"] in ["queued", "processing"]:
                self.jobs[job_id]["cancel_requested"] = True
                logger.info(f"Cancellation requested for job {job_id}")
                return True
            return False
    
    def is_job_cancelled(self, job_id: str) -> bool:
        """Check if job cancellation was requested"""
        with self.lock:
            return self.jobs.get(job_id, {}).get("cancel_requested", False)
    
    def cleanup_job(self, job_id: str):
        """Clean up job resources"""
        job = self.jobs.get(job_id)
        if job and job.get("output_dir"):
            try:
                if os.path.exists(job["output_dir"]):
                    shutil.rmtree(job["output_dir"])
                    logger.info(f"Cleaned up output directory for job {job_id}")
            except Exception as e:
                logger.error(f"Error cleaning up job {job_id}: {e}")
        
        with self.lock:
            self.jobs.pop(job_id, None)
            logger.info(f"Removed job {job_id} from memory")

# --- OCR Processing Service ---

class EvalOCRService:
    """OCR Service for evaluation system using PDFProcessor"""
    
    def __init__(self, config_path: str = "configs/config.yaml"):
        self.config = Config(config_path)
        self.pdf_processor = AdvancedPDFProcessor(self.config)
        self.job_manager = EvalJobManager()
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        
    def start_batch_processing(self, pdf_content, language: str = "hin",
                             use_google_ocr: bool = False) -> str:
        """
        Start batch processing of a PDF file
        pdf_content can be bytes or a file path
        Returns job ID
        """
        job_id = self.job_manager.create_job("batch_ocr")

        # Start processing in background
        future = self.executor.submit(
            self._process_pdf_batch,
            job_id, pdf_content, language, use_google_ocr
        )
        
        return job_id
    
    def _process_pdf_batch(self, job_id: str, pdf_file, language: str, use_google_ocr: bool):
        """Background batch processing of PDF"""
        output_dir = None
        
        try:
            # Acquire semaphore for concurrency control
            with self.job_manager.job_semaphore:
                if self.job_manager.is_job_cancelled(job_id):
                    self.job_manager.update_job_status(job_id, "canceled")
                    return
                
                self.job_manager.update_job_status(job_id, "preparing")
                
                # Create temporary output directory
                output_dir = tempfile.mkdtemp(prefix=f"eval_ocr_{job_id}_")
                self.job_manager.update_job_status(job_id, "preparing", output_dir=output_dir)
                
                # Save PDF content temporarily
                with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_pdf:
                    if isinstance(pdf_file, bytes):
                        # Content is already bytes from FastAPI
                        temp_pdf.write(pdf_file)
                    elif isinstance(pdf_file, str):
                        # File path - read from file
                        with open(pdf_file, 'rb') as f:
                            temp_pdf.write(f.read())
                    elif hasattr(pdf_file, 'read'):
                        # File-like object - read content
                        if hasattr(pdf_file, 'seek'):
                            pdf_file.seek(0)
                        content = pdf_file.read()
                        if isinstance(content, str):
                            content = content.encode()
                        temp_pdf.write(content)
                    else:
                        raise ValueError(f"Unsupported pdf_file type: {type(pdf_file)}")
                    
                    temp_pdf.flush()  # Ensure data is written to disk
                    temp_pdf_path = temp_pdf.name
                
                try:
                    # Build scan_config for PDFProcessor
                    scan_config = {}
                    
                    # Convert language
                    lang_map = {"hin": "hi", "guj": "gu", "eng": "en"}
                    processor_lang = lang_map.get(language, "hi")
                    
                    # Extract images using PDFProcessor
                    if self.job_manager.is_job_cancelled(job_id):
                        self.job_manager.update_job_status(job_id, "canceled")
                        return
                    
                    # Get total pages first
                    import fitz  # PyMuPDF
                    pdf_doc = fitz.open(temp_pdf_path)
                    total_pages = pdf_doc.page_count
                    pdf_doc.close()
                    
                    self.job_manager.update_job_status(
                        job_id, "processing", 
                        total_pages=total_pages
                    )
                    
                    # Process all pages
                    page_list = list(range(1, total_pages + 1))
                    images, page_numbers = self.pdf_processor._get_image(
                        temp_pdf_path, page_list, scan_config
                    )
                    
                    if not images:
                        raise Exception("Failed to extract pages from PDF")
                    
                    # Process pages in parallel using ThreadPoolExecutor
                    tesseract_lang = self.pdf_processor._pytesseract_language_map[processor_lang]

                    # Helper function for processing individual pages
                    def process_single_page_wrapper(args):
                        page_num, image = args
                        if self.job_manager.is_job_cancelled(job_id):
                            return None

                        generated_paragraphs, _ = process_image_to_paragraphs(
                            image, lang=tesseract_lang, page_num=page_num
                        )
                        page_text = "\n\n----\n\n".join(p.text for p in generated_paragraphs)
                        return page_num, page_text
                    
                    # Process pages in parallel (2 workers for page processing)
                    completed_pages = 0
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as page_executor:
                        # Submit all page processing tasks
                        future_to_page = {
                            page_executor.submit(process_single_page_wrapper, (page_num, image)): page_num
                            for page_num, image in zip(page_numbers, images)
                        }
                        
                        # Process completed tasks as they finish
                        for future in concurrent.futures.as_completed(future_to_page):
                            if self.job_manager.is_job_cancelled(job_id):
                                # Cancel remaining futures
                                for f in future_to_page:
                                    f.cancel()
                                self.job_manager.update_job_status(job_id, "canceled")
                                return
                            
                            try:
                                result = future.result()
                                if result is not None:
                                    page_num, page_text = result
                                    
                                    # Save to output file
                                    page_filename = f"page_{page_num:04d}.txt"
                                    with open(os.path.join(output_dir, page_filename), "w", encoding="utf-8") as f:
                                        f.write(page_text)
                                    
                                    # Update progress
                                    completed_pages += 1
                                    self.job_manager.update_job_progress(job_id, completed_pages)
                                    
                            except Exception as e:
                                logger.error(f"Error processing page {future_to_page[future]}: {e}")
                                # Continue processing other pages
                    
                    # Create ZIP file
                    if self.job_manager.is_job_cancelled(job_id):
                        self.job_manager.update_job_status(job_id, "canceled")
                        return
                    
                    zip_filename = f"extracted_text_{job_id}.zip"
                    zip_path = os.path.join(output_dir, zip_filename)
                    
                    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                        for root, dirs, files in os.walk(output_dir):
                            for file in files:
                                if file.endswith('.txt'):
                                    file_path = os.path.join(root, file)
                                    arcname = os.path.relpath(file_path, output_dir)
                                    zipf.write(file_path, arcname)
                    
                    self.job_manager.update_job_status(
                        job_id, "completed",
                        zip_filename=zip_filename,
                        completion_time=time.time()
                    )
                    
                    logger.info(f"Job {job_id} completed successfully")
                    
                finally:
                    # Clean up temporary PDF file
                    try:
                        os.unlink(temp_pdf_path)
                    except Exception:
                        pass
                
        except Exception as e:
            logger.error(f"Error in batch processing job {job_id}: {e}")
            self.job_manager.update_job_status(
                job_id, "failed",
                error=str(e)
            )
        
    def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get job status with elapsed time"""
        job = self.job_manager.get_job_status(job_id)
        if job:
            # Add elapsed time calculation
            current_time = time.time()
            elapsed_seconds = current_time - job["created_at"]
            job["elapsed_time"] = elapsed_seconds
            
            # Add formatted elapsed time for display
            if elapsed_seconds < 60:
                job["elapsed_time_formatted"] = f"{elapsed_seconds:.1f}s"
            elif elapsed_seconds < 3600:
                minutes = elapsed_seconds / 60
                job["elapsed_time_formatted"] = f"{minutes:.1f}m"
            else:
                hours = elapsed_seconds / 3600
                job["elapsed_time_formatted"] = f"{hours:.1f}h"
        
        return job
    
    def cancel_job(self, job_id: str) -> bool:
        """Cancel a job"""
        return self.job_manager.request_job_cancellation(job_id)
    
    def get_download_path(self, job_id: str) -> Optional[str]:
        """Get path to downloadable ZIP file"""
        job = self.job_manager.get_job_status(job_id)
        if job and job["status"] == "completed" and job.get("zip_filename"):
            zip_path = os.path.join(job["output_dir"], job["zip_filename"])
            if os.path.exists(zip_path):
                return zip_path
        return None
    
    def calculate_cost(self, total_pages: int, use_google_ocr: bool = False) -> Dict:
        """Calculate processing cost"""
        if use_google_ocr:
            # Google Vision API pricing (approximate)
            cost_per_page = 0.13  # ₹0.13 per page
            total_cost = total_pages * cost_per_page
            return {
                "cost": f"{total_cost:.2f}",
                "pages": total_pages,
                "currency": "₹"
            }
        else:
            # Tesseract is free
            return {
                "cost": "0.00",
                "pages": total_pages,
                "currency": "₹"
            }
    
    def cleanup_old_jobs(self, max_age_hours: int = 1):
        """Clean up old completed jobs"""
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600
        
        jobs_to_cleanup = []
        for job_id, job in self.job_manager.jobs.items():
            if (job["status"] in ["completed", "failed", "canceled"] and 
                current_time - job.get("completion_time", job["updated_at"]) > max_age_seconds):
                jobs_to_cleanup.append(job_id)
        
        for job_id in jobs_to_cleanup:
            self.job_manager.cleanup_job(job_id)
        
        logger.info(f"Cleaned up {len(jobs_to_cleanup)} old jobs")

# --- Global service instance ---
_service_instance = None

def get_ocr_service() -> EvalOCRService:
    """Get or create global OCR service instance"""
    global _service_instance
    if _service_instance is None:
        _service_instance = EvalOCRService()
    return _service_instance