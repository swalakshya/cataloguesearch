"""ONNX reranker module for reranking sentence pairs."""
import logging
import time
import torch
from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer

log_handle = logging.getLogger(__name__)


class ONNXReranker:
    """A reusable class to handle the ONNX reranker model."""
    def __init__(self, model_path: str):
        log_handle.info("Loading ONNX model from '%s'...", model_path)
        self.model = ORTModelForSequenceClassification.from_pretrained(model_path)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        log_handle.info("Reranker model loaded successfully.")

    def predict(self, sentence_pairs: list[list[str]], batch_size: int = 4,
                max_length: int = 1500, timeout_seconds: int = 40):
        """Reranks a list of sentence pairs and returns their scores."""
        start_time = time.time()
        all_scores = []

        with torch.no_grad():
            for i in range(0, len(sentence_pairs), batch_size):
                # Check for timeout
                if time.time() - start_time > timeout_seconds:
                    log_handle.warning(
                        "Reranking timed out after %s seconds. "
                        "Returning %s results out of %s.",
                        timeout_seconds, len(all_scores), len(sentence_pairs))
                    break

                batch = sentence_pairs[i:i + batch_size]
                inputs = self.tokenizer(
                    batch,
                    padding=True,
                    truncation=True,
                    return_tensors="pt",
                    max_length=max_length,
                )
                outputs = self.model(**inputs)
                batch_scores = torch.sigmoid(outputs.logits.squeeze()).cpu().numpy()

                # Handle single item case where squeeze removes all dimensions
                if len(batch) == 1:
                    batch_scores = [batch_scores.item()]
                elif batch_scores.ndim == 0:
                    batch_scores = [batch_scores.item()]

                all_scores.extend(batch_scores)
        end_time = time.time()
        log_handle.info("Reranking took %.2f seconds", end_time - start_time)
        return all_scores
