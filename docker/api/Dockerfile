# --- Stage 1: Builder ---
# This stage installs all build-time dependencies and Python packages.
FROM python:3.13-slim AS builder

WORKDIR /app

# Install system dependencies for API only (no OCR/PDF processing)
RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    g++ \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy API requirements only (for better layer caching)
COPY requirements-base.txt requirements-api.txt ./

# Install Python dependencies (this layer will be cached unless requirements change)
# Force pip to install CPU-only versions of PyTorch and its dependencies
# by adding the PyTorch CPU-only index. This drastically reduces image size.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-api.txt

# --- Stage 2: Final Image ---
# This stage creates the final, smaller runtime image by copying
# only the necessary artifacts from the builder stage.
FROM python:3.13-slim

WORKDIR /app

# Install minimal runtime dependencies for API only
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy only the Python packages and essential binaries from the builder stage
COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
# Only copy essential Python binaries, not build tools
  COPY --from=builder /usr/local/bin/python* /usr/local/bin/
  COPY --from=builder /usr/local/bin/pip* /usr/local/bin/
  COPY --from=builder /usr/local/bin/uvicorn* /usr/local/bin/

# Copy static resources first (rarely change)
COPY models/bge-reranker-base-onnx /app/models/bge-reranker-base-onnx

# Copy and set up entrypoint script
COPY docker/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy frequently changing directories last for better layer caching
# This ensures that changes to backend/configs/utils don't invalidate earlier layers
COPY utils/ ./utils/
COPY configs/ ./configs/
COPY backend/ ./backend/

# Set environment variables
ENV PYTHONPATH=/app

# Expose port for API
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/metadata || exit 1

# Use entrypoint script
ENTRYPOINT ["/entrypoint.sh"]

# Default command to run the API server
CMD ["uvicorn", "backend.api.search_api:app", "--host", "0.0.0.0", "--port", "8000"]