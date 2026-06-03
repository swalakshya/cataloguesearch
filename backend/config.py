# config.py
import json
import os
import re
import sys

import yaml

# Keys exposed in the admin UI and their hardcoded defaults.
# These are the values used when neither config.yaml nor overrides.json supply them.
ADMIN_PARAM_DEFAULTS = {
    "rerank_batch_size":    4,
    "rerank_max_length":    1500,
    "rerank_oversample":    40,
    "ef_search":            128,
    "search_mode":          "auto",   # "auto" | "lexical" | "vector"
    "page_size_pravachan":  20,
    "page_size_granth":     10,
    "page_size_books":      20,
    "spelling_min_score":   0.6,
    "enable_reranking":     True,
}

# Agent-specific tunable params. At runtime, _build_agent_config() resolves these
# as: agent overrides (if set) on top of current effective main Search Config values.
AGENT_PARAM_DEFAULTS = {
    "rerank_oversample":  40,
    "rerank_batch_size":  4,
    "rerank_max_length":  1500,
}

class Config:
    _instance = None
    _settings = {}
    _overrides = {}        # search admin overrides
    _agent_overrides = {}  # agent-specific overrides (raw, persisted)
    _agent_config = {}     # resolved agent config (rebuilt on load/update)

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
        elif name == "ENABLE_RERANKER":
            return self._settings.get("vector_embeddings", {}).get("enable_reranker", True)
        elif name == "FILTERED_METADATA_FIELDS":
            return self._settings.get("search", {}).get("filtered_metadata_fields", {})
        elif name == "METRICS_DB_PATH":
            return os.environ.get("METRICS_DB_PATH")
        elif name == "DEBUG_MODE":
            return os.environ.get("DEBUG", "").lower() == "true"
        elif name == "ACTIVE_CATEGORIES":
            if "active_categories" in self._overrides:
                return self._overrides["active_categories"]
            if os.environ.get("DEBUG", "").lower() == "true":
                return ["Pravachan", "Granth", "Books"]
            return self._settings.get("search", {}).get("active_categories", ["Pravachan", "Granth"])
        elif name == "RERANK_BATCH_SIZE":
            return self._overrides.get("rerank_batch_size", ADMIN_PARAM_DEFAULTS["rerank_batch_size"])
        elif name == "RERANK_MAX_LENGTH":
            return self._overrides.get("rerank_max_length", ADMIN_PARAM_DEFAULTS["rerank_max_length"])
        elif name == "RERANK_OVERSAMPLE":
            return self._overrides.get("rerank_oversample", ADMIN_PARAM_DEFAULTS["rerank_oversample"])
        elif name == "EF_SEARCH":
            return self._overrides.get("ef_search", ADMIN_PARAM_DEFAULTS["ef_search"])
        elif name == "SEARCH_MODE":
            return self._overrides.get("search_mode", ADMIN_PARAM_DEFAULTS["search_mode"])
        elif name == "PAGE_SIZE_PRAVACHAN":
            return self._overrides.get("page_size_pravachan", ADMIN_PARAM_DEFAULTS["page_size_pravachan"])
        elif name == "PAGE_SIZE_GRANTH":
            return self._overrides.get("page_size_granth", ADMIN_PARAM_DEFAULTS["page_size_granth"])
        elif name == "PAGE_SIZE_BOOKS":
            return self._overrides.get("page_size_books", ADMIN_PARAM_DEFAULTS["page_size_books"])
        elif name == "SPELLING_MIN_SCORE":
            return self._overrides.get("spelling_min_score", ADMIN_PARAM_DEFAULTS["spelling_min_score"])
        elif name == "ENABLE_RERANKING":
            return self._overrides.get("enable_reranking", ADMIN_PARAM_DEFAULTS["enable_reranking"])
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
        elif name == "TESSDATA_DIR":
            return self._settings.get("crawler", {}).get("tessdata_dir", "")
        elif name == "DEFAULT_LLM_MODEL":
            return self._settings.get("crawler", {}).get("default_llm_model", "gemini-2.5-flash")
        elif name == "SECONDARY_LLM_MODEL":
            return self._settings.get("crawler", {}).get("secondary_llm_model", None)
        elif name == "LLM_WORKERS":
            return self._settings.get("crawler", {}).get("llm_workers", 2)
        else:
            raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    # ------------------------------------------------------------------
    # Admin override helpers
    # ------------------------------------------------------------------

    def load_overrides(self, overrides_path: str):
        """Load admin overrides from JSON file. Call at startup."""
        if os.path.exists(overrides_path):
            try:
                with open(overrides_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                self._agent_overrides = data.pop("agent", {})
                self._overrides = data
                print(f"Loaded admin overrides from {overrides_path}: {self._overrides}")
                if self._agent_overrides:
                    print(f"Loaded agent overrides: {self._agent_overrides}")
            except json.JSONDecodeError as exc:
                print(f"WARNING: overrides.json is corrupt and will be ignored: {exc}")
                self._overrides = {}
                self._agent_overrides = {}
        else:
            self._overrides = {}
            self._agent_overrides = {}
        self._agent_config = self._build_agent_config()

    def _build_agent_config(self) -> dict:
        """Resolve agent config: agent overrides on top of current effective main values."""
        resolved = {
            "rerank_oversample": self.RERANK_OVERSAMPLE,
            "rerank_batch_size": self.RERANK_BATCH_SIZE,
            "rerank_max_length": self.RERANK_MAX_LENGTH,
        }
        resolved.update(self._agent_overrides)
        return resolved

    def get_agent_defaults(self) -> dict:
        """Return agent param defaults as the current effective main config values."""
        return {
            "rerank_oversample": self.RERANK_OVERSAMPLE,
            "rerank_batch_size": self.RERANK_BATCH_SIZE,
            "rerank_max_length": self.RERANK_MAX_LENGTH,
        }

    def update_agent_overrides(self, overrides_path: str, updates: dict):
        """Merge updates into agent overrides, persist, and rebuild resolved config."""
        coerced = {k: self._coerce_override(k, v) for k, v in updates.items()}
        self._agent_overrides.update(coerced)
        self._write_overrides(overrides_path)
        self._agent_config = self._build_agent_config()

    def reset_agent_overrides(self, overrides_path: str, key: str = None):
        """Remove one agent override key or all, persist, and rebuild resolved config."""
        if key:
            self._agent_overrides.pop(key, None)
        else:
            self._agent_overrides = {}
        self._write_overrides(overrides_path)
        self._agent_config = self._build_agent_config()

    def _coerce_override(self, key: str, value):
        """Coerce an override value to the type expected by ADMIN_PARAM_DEFAULTS."""
        expected = ADMIN_PARAM_DEFAULTS.get(key)
        if expected is None:
            return value  # unknown key — pass through unchanged
        expected_type = type(expected)
        if expected_type is bool:
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes")
            return bool(value)
        if expected_type is int:
            return int(value)
        if expected_type is float:
            return float(value)
        if expected_type is str:
            return str(value)
        return value

    def update_overrides(self, overrides_path: str, updates: dict):
        """Merge updates into overrides, persist, and rebuild agent config."""
        coerced = {k: self._coerce_override(k, v) for k, v in updates.items()}
        self._overrides.update(coerced)
        self._write_overrides(overrides_path)
        self._agent_config = self._build_agent_config()

    def reset_overrides(self, overrides_path: str, key: str = None):
        """Remove one key or all overrides, persist, and rebuild agent config."""
        if key:
            self._overrides.pop(key, None)
        else:
            self._overrides = {}
        self._write_overrides(overrides_path)
        self._agent_config = self._build_agent_config()

    def _write_overrides(self, overrides_path: str):
        data = dict(self._overrides)
        if self._agent_overrides:
            data["agent"] = self._agent_overrides
        with open(overrides_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)

    def get_defaults(self) -> dict:
        """Return admin param defaults (from ADMIN_PARAM_DEFAULTS + config.yaml active_categories)."""
        defaults = dict(ADMIN_PARAM_DEFAULTS)
        if os.environ.get("DEBUG", "").lower() == "true":
            defaults["active_categories"] = ["Pravachan", "Granth", "Books"]
        else:
            defaults["active_categories"] = self._settings.get(
                "search", {}
            ).get("active_categories", ["Pravachan", "Granth"])
        return defaults

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
        cls._overrides = {}
        cls._agent_overrides = {}
        cls._agent_config = {}