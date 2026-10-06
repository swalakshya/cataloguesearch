#!/usr/bin/env python3
"""Prepare the OpenSearch reranker package using the shared ONNX exporter.

Replaces the legacy optimum exporter. Output now defaults to
models/opensearch/bge-reranker-base/ (model.zip, manifest and reference fixture).
Use --help for output/revision options. Failures return a nonzero exit status.
"""
from prepare_opensearch_models import main


if __name__ == '__main__':
    main(default_model='reranker')
