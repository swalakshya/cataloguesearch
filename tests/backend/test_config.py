import json
import logging
import os

import numpy as np
import pytest

from backend.config import Config
from backend.utils import CustomJSONEncoder
from tests.backend.base import *

log_handle = logging.getLogger(__name__)


def test_config_instance():
    """
    Tests that the Config instance is created correctly and has expected attributes.
    """
    config = Config()
    index_name = "cataloguesearch_pytest"

    assert isinstance(config, Config)
    assert config.BASE_PDF_PATH == "%s/pdfs" % get_test_data_dir()
    assert config.BASE_TEXT_PATH == "%s/text" % get_test_data_dir()
    assert config.OPENSEARCH_HOST == "localhost"
    assert config.OPENSEARCH_PORT == 19200
    assert config.OPENSEARCH_USERNAME == "admin"
    assert config.OPENSEARCH_PASSWORD == "Admin@Password123!"
    assert config.OPENSEARCH_INDEX_NAME == index_name
    assert config.EMBEDDING_MODEL_NAME == "BAAI/bge-m3"
    assert config.RERANKING_MODEL_NAME == "BAAI/bge-reranker-base"
    assert config.CHUNK_STRATEGY in ["advanced", "paragraph"]
    log_handle.info(f"END TEST_CONFIG_INSTANCE")


def test_custom_json_encoder_numpy_float():
    assert json.dumps(np.float32(1.5), cls=CustomJSONEncoder) == "1.5"
    assert json.dumps(np.float64(3.14), cls=CustomJSONEncoder) == "3.14"


def test_custom_json_encoder_numpy_int():
    assert json.dumps(np.int32(42), cls=CustomJSONEncoder) == "42"
    assert json.dumps(np.int64(100), cls=CustomJSONEncoder) == "100"


def test_custom_json_encoder_numpy_array():
    result = json.loads(json.dumps(np.array([1.0, 2.0, 3.0]), cls=CustomJSONEncoder))
    assert result == [1.0, 2.0, 3.0]


def test_custom_json_encoder_set():
    result = json.loads(json.dumps({"values": {1, 2, 3}}, cls=CustomJSONEncoder))
    assert set(result["values"]) == {1, 2, 3}