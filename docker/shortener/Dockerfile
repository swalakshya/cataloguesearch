FROM python:3.13-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    g++ \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-base.txt requirements-api.txt ./
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-api.txt

FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin/python* /usr/local/bin/
COPY --from=builder /usr/local/bin/pip* /usr/local/bin/
COPY --from=builder /usr/local/bin/uvicorn* /usr/local/bin/

COPY docker/shortener/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY configs/ ./configs/
COPY backend/ ./backend/
COPY utils/ ./utils/

ENV PYTHONPATH=/app

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8100/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "backend.shortener.app:app", "--host", "0.0.0.0", "--port", "8100"]
