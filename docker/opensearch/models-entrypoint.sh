#!/bin/bash
set -euo pipefail
python3 -c "from pathlib import Path; Path('/tmp/opensearch-models-ready').unlink(missing_ok=True)"
python3 /usr/local/bin/seed-runtime.py
/usr/local/bin/entrypoint.sh &
OPENSEARCH_PID=$!
trap 'kill "$OPENSEARCH_PID" 2>/dev/null || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

ready=false
for ((i=0; i<120; i++)); do
    if ! kill -0 "$OPENSEARCH_PID" 2>/dev/null; then
        echo 'OpenSearch exited before model bootstrap' >&2
        exit 1
    fi
    if curl --max-time 5 -fsS http://localhost:9200/_cluster/health >/dev/null; then
        ready=true
        break
    fi
    sleep 5
done
if [ "$ready" != true ]; then
    echo 'OpenSearch did not become ready for model bootstrap' >&2
    exit 1
fi
python3 /usr/local/bin/register-opensearch-models.py \
    --models-dir /opt/opensearch-models \
    --bind 127.0.0.1 --model-base-url http://127.0.0.1:8081
# Written only after both models pass live prediction parity checks.
touch /tmp/opensearch-models-ready
wait "$OPENSEARCH_PID"
