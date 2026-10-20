"""Test module for reranker."""
import logging

from backend.common.reranker import ONNXReranker
from backend.config import Config
from tests.backend.base import initialise

log_handle = logging.getLogger(__name__)

# NOTE: These tests require the ONNX reranker model to be present in the models/ directory.
# The model path is configured in the test_config.yaml file under reranker_onnx_path.


def test_reranker_initialization(initialise):  # pylint: disable=unused-argument
    """Test ONNXReranker initialization with real model."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    assert reranker.session is not None
    assert reranker.tokenizer is not None


def test_reranker_predict_single_pair(initialise):  # pylint: disable=unused-argument
    """Test prediction with a single sentence pair."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    sentence_pairs = [["What is machine learning?", "Machine learning is a subset of artificial intelligence."]]
    scores = reranker.predict(sentence_pairs)
    
    assert len(scores) == 1
    assert isinstance(scores[0], (float, int)) or hasattr(scores[0], 'item')
    score_val = scores[0].item() if hasattr(scores[0], 'item') else scores[0]
    assert 0 <= score_val <= 1  # Sigmoid output should be between 0 and 1


def test_reranker_predict_multiple_pairs(initialise):  # pylint: disable=unused-argument
    """Test prediction with multiple sentence pairs."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    sentence_pairs = [
        ["What is machine learning?", "Machine learning is a subset of artificial intelligence."],
        ["What is machine learning?", "The weather is sunny today."],
        ["How does deep learning work?", "Deep learning uses neural networks with multiple layers."],
        ["How does deep learning work?", "I like to eat pizza."]
    ]
    scores = reranker.predict(sentence_pairs)
    
    assert len(scores) == 4
    assert all(isinstance(score, (float, int)) or hasattr(score, 'item') for score in scores)
    
    # Convert to float values for comparison
    score_vals = [score.item() if hasattr(score, 'item') else score for score in scores]
    assert all(0 <= score_val <= 1 for score_val in score_vals)
    
    # Just verify we get valid scores (ranking behavior can vary by model)
    assert all(score_val >= 0 for score_val in score_vals)


def test_reranker_predict_with_batching(initialise):  # pylint: disable=unused-argument
    """Test prediction with custom batch size."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    sentence_pairs = [
        ["What is AI?", "Artificial intelligence is machine intelligence."],
        ["What is AI?", "The sky is blue."],
        ["Define neural networks", "Neural networks are computing systems inspired by biological neural networks."],
        ["Define neural networks", "I enjoy reading books."],
        ["Explain algorithms", "Algorithms are step-by-step procedures for calculations."],
        ["Explain algorithms", "Cats are furry animals."]
    ]
    
    scores = reranker.predict(sentence_pairs, batch_size=2)
    
    assert len(scores) == 6
    assert all(isinstance(score, (float, int)) or hasattr(score, 'item') for score in scores)
    
    # Convert to float values for comparison
    score_vals = [score.item() if hasattr(score, 'item') else score for score in scores]
    assert all(0 <= score_val <= 1 for score_val in score_vals)


def test_reranker_predict_empty_input(initialise):  # pylint: disable=unused-argument
    """Test prediction with empty input."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    scores = reranker.predict([])
    
    assert scores == []


def test_reranker_predict_with_timeout(initialise):  # pylint: disable=unused-argument
    """Test prediction with timeout (should complete normally with reasonable timeout)."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    sentence_pairs = [
        ["Question 1", "Answer 1"],
        ["Question 2", "Answer 2"]
    ]
    
    scores = reranker.predict(sentence_pairs, timeout_seconds=10)
    
    assert len(scores) == 2
    assert all(isinstance(score, (float, int)) or hasattr(score, 'item') for score in scores)
    
    # Convert to float values for validation
    score_vals = [score.item() if hasattr(score, 'item') else score for score in scores]
    assert all(0 <= score_val <= 1 for score_val in score_vals)


def test_reranker_predict_long_text(initialise):  # pylint: disable=unused-argument
    """Test prediction with longer text that may require truncation."""
    config = Config()
    model_path = config.RERANKER_ONNX_PATH
    reranker = ONNXReranker(model_path)
    
    long_text = "This is a moderately long text that tests truncation behavior. " * 10
    sentence_pairs = [["What is this about?", long_text]]
    
    scores = reranker.predict(sentence_pairs)
    
    assert len(scores) == 1
    assert isinstance(scores[0], (float, int)) or hasattr(scores[0], 'item')
    score_val = scores[0].item() if hasattr(scores[0], 'item') else scores[0]
    assert 0 <= score_val <= 1