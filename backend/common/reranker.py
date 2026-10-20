"""ONNX reranker module for reranking sentence pairs."""
import json
import logging
import os
import time

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

log_handle = logging.getLogger(__name__)


class ONNXReranker:
    """
    A reusable class to handle the ONNX reranker model.

    Loads the ONNX graph directly via onnxruntime.InferenceSession instead of
    optimum's ORTModelForSequenceClassification wrapper. optimum's own
    load_model() does nothing more than the same
    InferenceSession(path, providers=["CPUExecutionProvider"]) call with
    stock session options, so this reproduces identical runtime/threading
    behavior without the dependency -- optimum pins transformers below 4.47/
    4.58, which conflicts with surya-ocr's transformers>=5.x requirement (see
    heading_detector.py's Surya heading-detection integration).
    """

    def __init__(self, model_path: str):
        onnx_file = os.path.join(model_path, "model.onnx")
        log_handle.info("Loading ONNX model from '%s'...", onnx_file)
        self.session = ort.InferenceSession(onnx_file, providers=["CPUExecutionProvider"])
        tokenizer_options = {}
        config_path = os.path.join(model_path, "config.json")
        if os.path.isfile(config_path):
            with open(config_path, encoding="utf-8") as stream:
                model_type = json.load(stream).get("model_type")
            if model_type == "xlm-roberta":
                # Transformers can misidentify local XLM-R tokenizers as Mistral.
                # Keep XLM-R's Metaspace pre-tokenizer, without the Mistral regex patch.
                tokenizer_options["fix_mistral_regex"] = False
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, **tokenizer_options)

        # Read the graph's actual input names instead of hardcoding them
        # (e.g. bge-reranker-base has no token_type_ids input at all) -- keeps
        # this working if the ONNX model is ever swapped for a differently
        # architected reranker.
        self._input_names = {inp.name for inp in self.session.get_inputs()}
        self._output_name = self.session.get_outputs()[0].name
        log_handle.info("Reranker model loaded successfully.")

    def predict(self, sentence_pairs: list[list[str]], batch_size: int = 4,
                max_length: int = 1500, timeout_seconds: int = 40):
        """Reranks a list of sentence pairs and returns their scores."""
        start_time = time.time()
        all_scores = []

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
                return_tensors="np",
                max_length=max_length,
            )
            onnx_inputs = {name: inputs[name] for name in self._input_names if name in inputs}
            logits = self.session.run([self._output_name], onnx_inputs)[0]
            # logits shape is (batch, 1) -- squeeze only the last axis so a
            # batch of 1 still comes out as a 1-element array, not a scalar.
            batch_scores = 1.0 / (1.0 + np.exp(-logits.squeeze(-1)))
            all_scores.extend(batch_scores.tolist())

        end_time = time.time()
        log_handle.info("Reranking took %.2f seconds", end_time - start_time)
        return all_scores
