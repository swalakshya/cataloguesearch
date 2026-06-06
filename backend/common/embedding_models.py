"""Embedding models factory with support for different precision modes."""
import logging
import os
from typing import List, Dict, Any

from sentence_transformers import SentenceTransformer

from backend.config import Config
from backend.common.reranker import ONNXReranker

# Conditional import to avoid loading torch in Docker CPU environment
try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    torch = None
    _TORCH_AVAILABLE = False

log_handle = logging.getLogger(__name__)

_MODELS = {}
_DEVICE = None

def _get_device():
    """
    Determines the optimal compute device. Forces CPU if in a Docker environment,
    otherwise auto-detects GPU/MPS. Conditionally imports torch to avoid
    loading it in the CPU-only Docker environment.
    """
    global _DEVICE  # pylint: disable=global-statement
    if _DEVICE:
        return _DEVICE

    # If ENVIRONMENT is set, we're in Docker, so force CPU and avoid torch import.
    if Config.is_docker_environment():
        _DEVICE = 'cpu'
        log_handle.info("Running in Docker environment ('%s'). Forcing CPU.",
                        os.getenv('ENVIRONMENT'))
    else:
        # Not in Docker, so we can try to use GPU
        if _TORCH_AVAILABLE and torch is not None:
            if torch.cuda.is_available():
                _DEVICE = 'cuda'
            elif (hasattr(torch.backends, 'mps') and
                  torch.backends.mps.is_available()):
                _DEVICE = 'mps'
            else:
                _DEVICE = 'cpu'
            log_handle.info("Auto-detected best available device: %s", _DEVICE)
        else:
            log_handle.warning("torch is not installed. Falling back to CPU. "
                               "For GPU support, please install torch.")
            _DEVICE = 'cpu'

    n = int(os.environ.get("TORCH_NUM_THREADS", "0"))
    if n > 0 and _TORCH_AVAILABLE and torch is not None:
        torch.set_num_threads(n)
        log_handle.info("Limiting PyTorch CPU threads to %d.", n)

    return _DEVICE

class BaseEmbeddingModel:
    """Base embedding model class with CPU/GPU device management."""

    def __init__(self, config):
        self.config = config
        self.embedding_model_name = config.EMBEDDING_MODEL_NAME
        self.reranker_model_name = config.RERANKING_MODEL_NAME
        self.reranker_onnx_path = config.RERANKER_ONNX_PATH
        # Eagerly load models on initialization
        self._embedding_model = self._load_embedding_model()
        self._reranker_model = self._load_reranker_model() if config.ENABLE_RERANKER else None
        if not config.ENABLE_RERANKER:
            log_handle.info("Reranker disabled via config (enable_reranker: false). Model not loaded.")

    def get_class(self, config: Dict[str, Any]) -> 'BaseEmbeddingModel':
        """Returns an instance of this class with the given config."""
        return self.__class__(config)

    def get_embedding(self, text: str) -> List[float]:
        """Generate embedding vector for the given text."""
        try:
            embedding = self._embedding_model.encode(text).tolist()
            log_handle.debug("Generated embedding for text (first 10 dims): %s...",
                           embedding[:10])
            return embedding
        except Exception as e:  # pylint: disable=broad-exception-caught
            log_handle.error("Error generating embedding for text: '%s...'. Error: %s",
                           text[:50], e)
            return [0.0] * self._embedding_model.get_sentence_embedding_dimension()

    def get_embeddings_batch(self, texts: List[str],
                           batch_size: int = 8) -> List[List[float]]:
        """
        Generate embeddings for a batch of texts efficiently.

        Args:
            texts: List of text strings to encode
            batch_size: Batch size for processing

        Returns:
            List of embedding vectors
        """
        try:
            log_handle.debug("Generating embeddings for a batch of %d texts...",
                           len(texts))
            # The encode method of SentenceTransformer is highly optimized for batching.
            embeddings = self._embedding_model.encode(
                texts,
                batch_size=batch_size,
                show_progress_bar=True
            )
            return embeddings.tolist()
        except Exception as e:  # pylint: disable=broad-exception-caught
            log_handle.error("Error generating batch embeddings. Error: %s", e, exc_info=True)
            # Return a list of zero vectors matching the input length
            return [[0.0] * self.get_embedding_dimension()] * len(texts)

    def get_reranking_model(self) -> ONNXReranker | None:
        """Get the reranking model instance, or None if disabled via config."""
        return self._reranker_model

    def get_embedding_dimension(self) -> int:
        """Get the dimensionality of embeddings from the model."""
        return self._embedding_model.get_sentence_embedding_dimension()

    def _load_embedding_model(self) -> SentenceTransformer:
        """Load and cache the embedding model."""
        global _MODELS  # pylint: disable=global-variable-not-assigned
        model_key = f"{self.embedding_model_name}_{self.__class__.__name__}"

        if model_key not in _MODELS:
            try:
                log_handle.info("Loading embedding model: %s...",
                                self.embedding_model_name)
                device = _get_device()
                model = SentenceTransformer(self.embedding_model_name,
                                            device=device)
                model.eval()
                for param in model.parameters():
                    param.requires_grad = False
                _MODELS[model_key] = model
                log_handle.info(
                    "Embedding model '%s' loaded successfully on device '%s'.",
                    self.embedding_model_name, device)
            except Exception as e:
                log_handle.error("Failed to load embedding model '%s': %s",
                               self.embedding_model_name, e)
                raise
        else:
            log_handle.info("Using pre-loaded embedding model: %s",
                           self.embedding_model_name)
        return _MODELS[model_key]

    def _load_reranker_model(self) -> ONNXReranker:
        """
        Load the ONNX reranker model.

        This is the only supported reranker. If the model path is not
        configured or not found, this will raise a critical error.

        Returns:
            ONNXReranker instance

        Raises:
            FileNotFoundError: If reranker model path not found
        """
        global _MODELS  # pylint: disable=global-variable-not-assigned
        model_key = f"onnx_{self.reranker_onnx_path}"

        if model_key in _MODELS:
            log_handle.info("Using pre-loaded ONNX reranker from: %s",
                           self.reranker_onnx_path)
            return _MODELS[model_key]

        # The ONNX model is now a hard requirement. Fail fast if not configured/found.
        if not self.reranker_onnx_path or not os.path.exists(self.reranker_onnx_path):
            log_handle.critical(
                "ONNX reranker path not configured or not found: '%s'. "
                "This is a fatal error.", self.reranker_onnx_path)
            raise FileNotFoundError(
                f"Required ONNX reranker model not found at path: "
                f"{self.reranker_onnx_path}")

        try:
            model = ONNXReranker(self.reranker_onnx_path)
            _MODELS[model_key] = model
            return model
        except Exception as e:
            log_handle.critical(
                "Fatal error loading ONNX reranker from '%s': %s",
                self.reranker_onnx_path, e,
                exc_info=True)
            raise

class FP16EmbeddingModel(BaseEmbeddingModel):
    """FP16 precision embedding model for memory optimization on GPU."""

    def _load_embedding_model(self) -> SentenceTransformer:
        """Load embedding model with FP16 precision optimization."""
        global _MODELS  # pylint: disable=global-variable-not-assigned
        model_key = f"{self.embedding_model_name}_{self.__class__.__name__}"

        if model_key not in _MODELS:
            try:
                log_handle.info("Loading FP16 embedding model: %s...",
                               self.embedding_model_name)
                device = _get_device()
                model = SentenceTransformer(self.embedding_model_name,
                                          device=device)

                # FP16 is beneficial on CUDA/MPS, but not always on CPU.
                if device != 'cpu':
                    model.half()
                    log_handle.info("Converted model to FP16 (half precision).")

                # Set to eval mode to save memory
                model.eval()
                # Disable gradients to save memory
                for param in model.parameters():
                    param.requires_grad = False
                _MODELS[model_key] = model
                log_handle.info(
                    "FP16 embedding model '%s' loaded successfully on device '%s'.",
                    self.embedding_model_name, device)
            except Exception as e:
                log_handle.error("Failed to load FP16 embedding model '%s': %s",
                               self.embedding_model_name, e)
                raise
        else:
            log_handle.info("Using pre-loaded embedding model: %s",
                           self.embedding_model_name)
        return _MODELS[model_key]

class Quantized8BitEmbeddingModel(BaseEmbeddingModel):
    """8-bit quantized embedding model for CPU optimization."""

    def _load_embedding_model(self) -> SentenceTransformer:
        """Load embedding model with CPU optimization."""
        global _MODELS  # pylint: disable=global-variable-not-assigned
        model_key = f"{self.embedding_model_name}_{self.__class__.__name__}"

        if model_key not in _MODELS:
            try:
                log_handle.info("Loading 8-bit quantized embedding model: %s...",
                               self.embedding_model_name)
                device = _get_device()
                model = SentenceTransformer(self.embedding_model_name,
                                          device=device)
                # Set to eval mode to save memory
                model.eval()
                # Disable gradients to save memory
                for param in model.parameters():
                    param.requires_grad = False
                _MODELS[model_key] = model
                log_handle.info(
                    "CPU-optimized embedding model '%s' loaded successfully "
                    "on device '%s'.", self.embedding_model_name, device)
            except Exception as e:
                log_handle.error("Failed to load embedding model '%s': %s",
                               self.embedding_model_name, e)
                raise
        else:
            log_handle.info("Using pre-loaded embedding model: %s",
                           self.embedding_model_name)
        return _MODELS[model_key]

def get_embedding_model_factory(config) -> BaseEmbeddingModel:
    """Factory function to create embedding models based on configuration.

    Args:
        config: Configuration object with EMBEDDING_MODEL_TYPE setting

    Returns:
        BaseEmbeddingModel instance of the requested type
    """
    model_type = config.EMBEDDING_MODEL_TYPE
    factory_key = f"factory_{model_type}"

    global _MODELS  # pylint: disable=global-variable-not-assigned
    if factory_key in _MODELS:
        log_handle.info("Using pre-loaded embedding model factory of type: %s",
                       model_type)
        return _MODELS[factory_key]

    log_handle.info("Creating new embedding model factory of type: %s",
                   model_type)
    if model_type == "fp16":
        factory_instance = FP16EmbeddingModel(config)
    elif model_type == "quantized_8bit":
        factory_instance = Quantized8BitEmbeddingModel(config)
    else:
        factory_instance = BaseEmbeddingModel(config)

    _MODELS[factory_key] = factory_instance
    return factory_instance
