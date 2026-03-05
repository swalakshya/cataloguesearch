# config.py
import os
import re
import sys

import yaml

class Config:
    _instance = None
    _settings = {}

    def __new__(cls, config_file_path: str = None):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            cls._instance._load_config(config_file_path)
        return cls._instance

    @staticmethod
    def _replace_env_placeholders(obj):
        if isinstance(obj, dict):
            return {k: Config._replace_env_placeholders(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [Config._replace_env_placeholders(i) for i in obj]
        elif isinstance(obj, str):
            return re.sub(r"\{(\w+)\}", lambda m: os.getenv(m.group(1), ""), obj)
        else:
            return obj

    @staticmethod
    def _get_project_root():
        """
        Returns the root directory of the project.
        """
        current_path = os.path.abspath(__file__)
        dir_path = os.path.dirname(current_path)

        # Define common marker files/directories
        marker_files = [
            "pyproject.toml", ".git", "setup.py", "requirements.txt", "LICENSE"
        ]

        while dir_path != os.path.dirname(dir_path):
            for marker in marker_files:
                if os.path.exists(os.path.join(dir_path, marker)):
                    return dir_path
            dir_path = os.path.dirname(dir_path)
        return None

    def _load_config(self, config_file_path: str):
        """
        Loads configuration from a YAML file.
        If config_file_path is None or file not found, uses default values.
        """
        BASE_DIR = Config._get_project_root()
        # Fallback to environment variable if project root detection fails
        if BASE_DIR is None:
            BASE_DIR = os.environ.get("BASE_DIR", "/app")
        config_file_path = os.path.join(BASE_DIR, config_file_path)

        os.environ["BASE_DIR"] = BASE_DIR
        if config_file_path and os.path.exists(config_file_path):
            print(f"Loading configuration from {config_file_path}")
            with open(config_file_path, 'r', encoding='utf-8') as f:
                self._settings = yaml.safe_load(f)
        else:
            print(f"Config file not found at {config_file_path}. Exiting.")
            sys.exit(1)

        # Replace placeholders
        self._settings = Config._replace_env_placeholders(self._settings)
        print(f"Loaded config: {self._settings}")

    @staticmethod
    def is_docker_environment():
        """
        Checks if the code is running inside a Docker environment by checking
        for the /.dockerenv file or a specific environment variable.
        """
        # Check for the presence of the .dockerenv file at the root
        has_dockerenv = os.path.exists('/.dockerenv')
        # Check for the custom environment variable set in docker-compose
        has_env_var = os.getenv("ENVIRONMENT") in ["local", "prod"]
        return has_dockerenv or has_env_var


    def __getattr__(self, name):
        """
        Allows accessing config settings like attributes (e.g., config.FILE_INGESTION_PATH).
        This method flattens the nested YAML structure for easier access.
        """
        # Flatten the structure for easier access
        if name == "BASE_PDF_PATH":
            return self._settings.get("crawler", {}).get("base_pdf_path", None)
        elif name == "BASE_TEXT_PATH":
            return self._settings.get("crawler", {}).get("base_text_path", None)
        elif name == "BASE_OCR_PATH":
            return self._settings.get("crawler", {}).get("base_ocr_path", None)
        elif name == "SQLITE_DB_PATH":
            return self._settings.get("crawler", {}).get("sqlite_db_path", None)
        elif name == "OPENSEARCH_CONFIG_PATH":
            return self._settings.get("index", {}).get("opensearch_config", None)
        elif name == "CHUNK_STRATEGY":
            return self._settings.get("index", {}).get("chunk_strategy", "default")
        elif name == "OPENSEARCH_HOST":
            return self._settings.get("opensearch", {}).get("host") or "localhost"
        elif name == "OPENSEARCH_PORT":
            return self._settings.get("opensearch", {}).get("port") or 9200
        elif name == "OPENSEARCH_USERNAME":
            return self._settings.get("opensearch", {}).get("username", "admin")
        elif name == "OPENSEARCH_PASSWORD":
            return self._settings.get("opensearch", {}).get("password", "admin")
        elif name == "OPENSEARCH_INDEX_NAME":
            return self._settings.get("opensearch", {}).get("index_name", "document_chunks")
        elif name == "OPENSEARCH_METADATA_INDEX_NAME":
            return self._settings.get("opensearch", {}).get("metadata_index_name", "document_metadata")
        elif name == "EMBEDDING_MODEL_NAME":
            return self._settings.get("vector_embeddings", {}).get("embedding_model", "BAAI/bge-m3")
        elif name == "RERANKING_MODEL_NAME":
            return self._settings.get("vector_embeddings", {}).get("reranking_model", "BAAI/bge-reranker-v2-m3")
        elif name == "EMBEDDING_MODEL_TYPE":
            return self._settings.get("vector_embeddings", {}).get("embedding_model_type", "base")
        elif name == "RERANKER_ONNX_PATH":
            return self._settings.get("vector_embeddings", {}).get("reranker_onnx_path", None)
        elif name == "FILTERED_METADATA_FIELDS":
            return self._settings.get("search", {}).get("filtered_metadata_fields", {})
        elif name == "TRANSLITERATION_API_URL":
            return self._settings.get("transliteration", {}).get("api_url", "http://localhost:8001")
        elif name == "TRANSLITERATION_DEFAULT_LANGUAGE":
            return self._settings.get("transliteration", {}).get("default_language", "hi")
        elif name == "TRANSLITERATION_DEFAULT_TOPK":
            return self._settings.get("transliteration", {}).get("default_topk", 5)
        elif name == "TRANSLITERATION_TIMEOUT":
            return self._settings.get("transliteration", {}).get("timeout", 10)
        elif name == "BOOKMARK_EXTRACTOR_LLM":
            return self._settings.get("crawler", {}).get("bookmark_extractor_llm", "gemini")
        elif name == "OCR_ENGINE":
            return self._settings.get("crawler", {}).get("ocr_engine", "tesseract")
        elif name == "DEFAULT_LLM_MODEL":
            return self._settings.get("crawler", {}).get("default_llm_model", "gemini-2.5-flash")
        elif name == "LLM_WORKERS":
            return self._settings.get("crawler", {}).get("llm_workers", 2)
        else:
            raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    def settings(self):
        """Returns the raw dictionary of loaded settings."""
        return self._settings

    @classmethod
    def reset(cls):
        """Reset the singleton instance for testing.
        IMPORTANT: Use it wisely. Mostly for testing purposes only.
        """
        cls._instance = None
        cls._settings = {}