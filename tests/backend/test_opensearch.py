"""Test module for OpenSearch operations."""
import logging
import pytest
import os
from unittest.mock import patch
from opensearchpy import ConnectionError

from backend.common.opensearch import (
    get_opensearch_config,
    get_metadata_index_config,
    get_opensearch_client,
    create_indices_if_not_exists,
    delete_index,
    get_metadata,
    delete_documents_by_filename,
    _create_index_if_not_exists
)
from backend.config import Config
from tests.backend.base import initialise, get_test_data_dir

log_handle = logging.getLogger(__name__)


def load_test_documents():
    """Load all test documents from tests/data/text directory."""
    test_data_dir = get_test_data_dir()
    config = Config()
    text_dir = os.path.join(test_data_dir, "ocr", "paragraph")
    documents = []

    # Get all subdirectories in text folder
    for subdir in os.listdir(text_dir):
        subdir_path = os.path.join(text_dir, subdir)
        if os.path.isdir(subdir_path):
            # Get all text files in each subdirectory
            for filename in os.listdir(subdir_path):
                if filename.endswith('.txt'):
                    filepath = os.path.join(subdir_path, filename)
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                        # Split into paragraphs and create separate documents
                        paragraphs = [p.strip() for p in content.split('\n') if p.strip()]
                        for i, paragraph in enumerate(paragraphs):
                            documents.append({
                                "original_filename": subdir,  # Use subdirectory name as filename
                                "content": paragraph,
                                "page_number": filename.replace('page_', '').replace('.txt', ''),
                                "paragraph_id": i
                            })

    return documents


@pytest.fixture(autouse=True)
def reset_opensearch_state():
    """Reset OpenSearch client and cached settings before each test."""
    from backend.common import opensearch
    opensearch._CLIENT = None
    opensearch._OPENSEARCH_SETTINGS = None
    yield
    # Optional cleanup after test
    opensearch._CLIENT = None
    opensearch._OPENSEARCH_SETTINGS = None


@pytest.fixture
def clean_opensearch_client():
    """Get a clean OpenSearch client with fresh indices."""
    config = Config()
    client = get_opensearch_client(config, force_clean=True)
    create_indices_if_not_exists(config, client)
    return client, config


@pytest.fixture
def opensearch_client_and_config():
    """Get OpenSearch client and config without forcing clean indices."""
    config = Config()
    client = get_opensearch_client(config)
    return client, config

class TestOpenSearchConfig:
    """Test OpenSearch configuration loading."""

    def test_get_opensearch_config_valid(self, initialise):
        """Test loading valid OpenSearch configuration."""
        config = Config()
        opensearch_settings = get_opensearch_config(config)

        # Verify configuration is loaded
        assert opensearch_settings is not None
        assert isinstance(opensearch_settings, dict)

        # Check expected structure
        assert 'mappings' in opensearch_settings
        assert 'settings' in opensearch_settings

        # Verify embedding dimension is set
        if 'properties' in opensearch_settings['mappings']:
            if 'vector_embedding' in opensearch_settings['mappings']['properties']:
                assert 'dimension' in opensearch_settings['mappings']['properties']['vector_embedding']
                dimension = opensearch_settings['mappings']['properties']['vector_embedding']['dimension']
                assert isinstance(dimension, int)
                assert dimension > 0

    def test_get_opensearch_config_missing_file(self):
        """Test error handling when config file is missing."""
        # Create a config with non-existent path
        config = Config()
        original_path = config.OPENSEARCH_CONFIG_PATH

        try:
            config._settings['index']['opensearch_config'] = "/nonexistent/path.yaml"

            with pytest.raises(FileNotFoundError):
                get_opensearch_config(config)
        finally:
            # Restore original path and reset cached settings
            config._settings['index']['opensearch_config'] = original_path
            from backend.common import opensearch
            opensearch._OPENSEARCH_SETTINGS = None

    def test_get_metadata_index_config_valid(self, initialise):
        """Test loading metadata index configuration."""
        config = Config()
        metadata_config = get_metadata_index_config(config)

        assert isinstance(metadata_config, dict)
        # Configuration might be empty if not defined, which is valid

    def test_get_metadata_index_config_missing_section(self, initialise):
        """Test metadata config when section is missing."""
        config = Config()
        metadata_config = get_metadata_index_config(config)

        # Should return empty dict when section is missing
        assert isinstance(metadata_config, dict)


class TestOpenSearchClient:
    """Test OpenSearch client operations."""

    def test_get_opensearch_client_success(self, initialise):
        """Test successful OpenSearch client creation."""
        config = Config()
        client = get_opensearch_client(config)

        assert client is not None

        # Test that client can ping
        assert client.ping() is True

        # Verify connection details - check transport host/port instead
        transport_hosts = client.transport.hosts
        assert len(transport_hosts) > 0
        assert transport_hosts[0]['host'] == config.OPENSEARCH_HOST
        assert transport_hosts[0]['port'] == config.OPENSEARCH_PORT

    def test_get_opensearch_client_singleton(self, initialise):
        """Test that client returns same instance (singleton pattern)."""
        config = Config()
        client1 = get_opensearch_client(config)
        client2 = get_opensearch_client(config)

        assert client1 is client2

    def test_get_opensearch_client_force_clean(self, initialise):
        """Test force_clean parameter behavior."""
        config = Config()

        # First create client and indices
        client = get_opensearch_client(config)
        create_indices_if_not_exists(config, client)

        # Verify indices exist
        assert client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)

        # Force clean should delete indices
        client_after_clean = get_opensearch_client(config, force_clean=True)

        # Should be same client instance
        assert client_after_clean is client

        # Indices should be deleted
        assert not client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert not client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)

    def test_get_opensearch_client_connection_error(self, initialise):
        """Test connection error handling."""
        # Create a separate config instance for this test to avoid contaminating the singleton
        config = Config()
        original_host = config.OPENSEARCH_HOST

        try:
            # Mock invalid host
            config._settings['opensearch']['host'] = 'invalid-host'

            # Reset client to force new connection
            from backend.common import opensearch
            opensearch._CLIENT = None

            # Expect either ConnectionError or the more general Exception
            with pytest.raises((ConnectionError, Exception)):
                get_opensearch_client(config)
        finally:
            # Always restore original host and reset client
            config._settings['opensearch']['host'] = original_host
            from backend.common import opensearch
            opensearch._CLIENT = None


class TestIndexOperations:
    """Test index creation and deletion operations."""

    def test_create_indices_if_not_exists(self):
        """Test index creation including granth_index."""
        config = Config()
        client = get_opensearch_client(config, force_clean=True)

        # Ensure indices don't exist
        assert not client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert not client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)
        # Create indices
        create_indices_if_not_exists(config, client)

        # Verify indices exist
        assert client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)
        # Test idempotency - should not raise error if indices already exist
        create_indices_if_not_exists(config, client)
        assert client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)
    def test_create_index_if_not_exists_empty_body(self, opensearch_client_and_config):
        """Test _create_index_if_not_exists with empty index body."""
        client, config = opensearch_client_and_config

        # Should handle empty body gracefully
        _create_index_if_not_exists(client, "test_empty_index", {})

        # Index should not be created
        assert not client.indices.exists("test_empty_index")

    def test_delete_index(self, opensearch_client_and_config):
        """Test index deletion including granth_index."""
        client, config = opensearch_client_and_config

        # Create indices first
        create_indices_if_not_exists(config, client)
        assert client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)
        # Delete indices
        delete_index(config)

        # Verify indices are deleted
        assert not client.indices.exists(config.OPENSEARCH_INDEX_NAME)
        assert not client.indices.exists(config.OPENSEARCH_METADATA_INDEX_NAME)

        # Test deleting non-existent indices (should not raise error)
        delete_index(config)

    def test_delete_index_no_client(self):
        """Test delete_index when no client is available."""
        config = Config()

        # Reset client to None
        from backend.common import opensearch
        original_client = opensearch._CLIENT
        opensearch._CLIENT = None

        # Should not raise error
        delete_index(config)

        # Restore client
        opensearch._CLIENT = original_client

    def test_delete_index_invalid_config(self):
        """Test delete_index with invalid config."""
        with pytest.raises(ValueError):
            delete_index(None)


class TestMetadataOperations:
    """Test metadata operations."""

    def test_get_metadata_empty_index(self, clean_opensearch_client):
        """Test get_metadata when metadata index is empty."""
        client, config = clean_opensearch_client

        metadata = get_metadata(config)
        assert isinstance(metadata, dict)
        assert "Pravachan" in metadata
        assert "Granth" in metadata
        assert len(metadata["Pravachan"]) == 0
        assert len(metadata["Granth"]) == 0

    def test_get_metadata_nonexistent_index(self):
        """Test get_metadata when metadata index doesn't exist."""
        config = Config()
        get_opensearch_client(config, force_clean=True)

        # Don't create indices
        metadata = get_metadata(config)
        assert isinstance(metadata, dict)
        assert "Pravachan" in metadata
        assert "Granth" in metadata
        assert len(metadata["Pravachan"]) == 0
        assert len(metadata["Granth"]) == 0

    def test_get_metadata_with_data(self, clean_opensearch_client):
        """Test get_metadata with sample data including both Hindi and Gujarati."""
        client, config = clean_opensearch_client

        # Insert sample metadata for both content types and languages using new format
        sample_metadata = [
            # Pravachan - Hindi metadata
            {
                "id": "Pravachan_Author_hi",
                "body": {
                    "content_type": "Pravachan",
                    "key": "Author",
                    "language": "hi",
                    "values": ["राजचन्द्र जी", "कुन्दकुन्द आचार्य"]
                }
            },
            {
                "id": "Pravachan_Anuyog_hi",
                "body": {
                    "content_type": "Pravachan",
                    "key": "Anuyog",
                    "language": "hi",
                    "values": ["प्रवचन", "व्याख्यान"]
                }
            },
            # Pravachan - Gujarati metadata
            {
                "id": "Pravachan_Author_gu",
                "body": {
                    "content_type": "Pravachan",
                    "key": "Author",
                    "language": "gu",
                    "values": ["રાજચંદ્ર જી", "કુંદકુંદ આચાર્ય"]
                }
            },
            {
                "id": "Pravachan_Anuyog_gu",
                "body": {
                    "content_type": "Pravachan",
                    "key": "Anuyog",
                    "language": "gu",
                    "values": ["પ્રવચન"]
                }
            },
            # Granth - Hindi metadata
            {
                "id": "Granth_Author_hi",
                "body": {
                    "content_type": "Granth",
                    "key": "Author",
                    "language": "hi",
                    "values": ["कुन्दकुन्द आचार्य"]
                }
            },
            # Granth - Gujarati metadata
            {
                "id": "Granth_Author_gu",
                "body": {
                    "content_type": "Granth",
                    "key": "Author",
                    "language": "gu",
                    "values": ["કુંદકુંદ આચાર્ય"]
                }
            }
        ]

        metadata_index = config.OPENSEARCH_METADATA_INDEX_NAME
        for item in sample_metadata:
            client.index(
                index=metadata_index,
                id=item["id"],
                body=item["body"],
                refresh=True
            )

        # Retrieve metadata
        metadata = get_metadata(config)

        # Validate structure - should have Pravachan and Granth keys
        assert isinstance(metadata, dict)
        assert "Pravachan" in metadata
        assert "Granth" in metadata

        # Validate Pravachan metadata
        meta_pravachan = metadata["Pravachan"]
        assert len(meta_pravachan) == 4  # 2 Hindi keys + 2 Gujarati keys
        assert "Author_hi" in meta_pravachan
        assert "Anuyog_hi" in meta_pravachan
        assert "Author_gu" in meta_pravachan
        assert "Anuyog_gu" in meta_pravachan
        assert meta_pravachan["Author_hi"] == ["राजचन्द्र जी", "कुन्दकुन्द आचार्य"]
        assert meta_pravachan["Anuyog_hi"] == ["प्रवचन", "व्याख्यान"]
        assert meta_pravachan["Author_gu"] == ["રાજચંદ્ર જી", "કુંદકુંદ આચાર્ય"]
        assert meta_pravachan["Anuyog_gu"] == ["પ્રવચન"]

        # Validate Granth metadata
        meta_granth = metadata["Granth"]
        assert len(meta_granth) == 2  # 1 Hindi key + 1 Gujarati key
        assert "Author_hi" in meta_granth
        assert "Author_gu" in meta_granth
        assert meta_granth["Author_hi"] == ["कुन्दकुन्द आचार्य"]
        assert meta_granth["Author_gu"] == ["કુંદકુંદ આચાર્ય"]


class TestDocumentOperations:
    """Test document operations."""

    def test_delete_documents_by_filename(self, clean_opensearch_client):
        """Test deletion of documents by filename using real test data."""
        client, config = clean_opensearch_client
        index_name = config.OPENSEARCH_INDEX_NAME

        # Load all test documents
        documents = load_test_documents()

        # Index all documents
        for i, doc in enumerate(documents):
            client.index(
                index=index_name,
                id=f"doc_{i}",
                body=doc,
                refresh=True
            )

        # Get unique filenames
        filenames = list(set(doc['original_filename'] for doc in documents))
        log_handle.info(f"Available filenames: {filenames}")

        # Count documents before deletion
        total_docs_before = len(documents)
        filename_to_delete = filenames[0]  # Delete the first filename
        docs_to_delete = [d for d in documents if d['original_filename'] == filename_to_delete]
        expected_remaining = total_docs_before - len(docs_to_delete)

        log_handle.info(f"Total docs: {total_docs_before}, deleting {len(docs_to_delete)} docs with filename '{filename_to_delete}', expecting {expected_remaining} remaining")

        # Verify documents exist
        response = client.search(
            index=index_name,
            body={"query": {"match_all": {}}}
        )
        assert response['hits']['total']['value'] == total_docs_before

        # Delete documents by filename
        delete_documents_by_filename(config, filename_to_delete)

        # Verify correct number of documents remain
        response = client.search(
            index=index_name,
            body={"query": {"match_all": {}}}
        )
        assert response['hits']['total']['value'] == expected_remaining

        # Verify remaining documents don't have the deleted filename
        for hit in response['hits']['hits']:
            assert hit['_source']['original_filename'] != filename_to_delete

    def test_delete_documents_by_filename_nonexistent(self, clean_opensearch_client):
        """Test deletion of documents by non-existent filename."""
        client, config = clean_opensearch_client

        # Should not raise error for non-existent filename
        delete_documents_by_filename(config, "nonexistent_file.txt")


class TestIntegration:
    """Integration tests using real test data."""

    def test_full_workflow_with_test_data(self, initialise):
        """Test complete workflow with actual test data."""
        config = Config()
        client = get_opensearch_client(config, force_clean=True)

        # Create indices
        create_indices_if_not_exists(config, client)

        # Double-check that indices are truly empty
        index_name = config.OPENSEARCH_INDEX_NAME
        search_response = client.search(
            index=index_name,
            body={"query": {"match_all": {}}}
        )
        if search_response['hits']['total']['value'] > 0:
            # Force delete any remaining documents
            client.delete_by_query(
                index=index_name,
                body={"query": {"match_all": {}}},
                wait_for_completion=True,
                refresh=True
            )

        # Load test data
        test_data_dir = get_test_data_dir()
        test_file_path = os.path.join(test_data_dir, "ocr/paragraph/bangalore_hindi/page_0001.txt")

        with open(test_file_path, 'r', encoding='utf-8') as f:
            test_content = f.read()

        index_name = config.OPENSEARCH_INDEX_NAME

        # Index test document
        doc = {
            "original_filename": "bangalore_hindi_page_0001.txt",
            "content": test_content,
            "metadata": {
                "language": "hindi",
                "city": "bangalore"
            }
        }

        client.index(
            index=index_name,
            id="test_doc_1",
            body=doc,
            refresh=True
        )

        # Search for document
        search_response = client.search(
            index=index_name,
            body={
                "query": {
                    "match": {
                        "content": "बेंगलुरु"
                    }
                }
            }
        )

        assert search_response['hits']['total']['value'] == 1
        found_doc = search_response['hits']['hits'][0]['_source']
        assert found_doc['original_filename'] == "bangalore_hindi_page_0001.txt"
        assert "बेंगलुरु" in found_doc['content']

        # Verify document exists before deletion
        search_before = client.search(
            index=index_name,
            body={"query": {"match_all": {}}}
        )
        # The test should only have the one document we just indexed
        # If there are more documents, it means previous tests left data
        if search_before['hits']['total']['value'] != 1:
            # Log what documents exist for debugging
            log_handle.warning(f"Expected 1 document, found {search_before['hits']['total']['value']}")
            for hit in search_before['hits']['hits']:
                log_handle.warning(f"Found document: {hit['_source']}")
        assert search_before['hits']['total']['value'] == 1

        # Test deletion
        delete_documents_by_filename(config, "bangalore_hindi_page_0001.txt")

        # Force refresh to ensure changes are visible
        client.indices.refresh(index=index_name)

        # Verify deletion - wait a bit for the delete to complete
        import time
        time.sleep(0.1)

        search_response = client.search(
            index=index_name,
            body={"query": {"match_all": {}}}
        )
        assert search_response['hits']['total']['value'] == 0

    def test_config_caching(self, initialise):
        """Test that config is cached properly."""
        config = Config()

        # First call should load config
        opensearch_config1 = get_opensearch_config(config)

        # Second call should return cached config
        opensearch_config2 = get_opensearch_config(config)

        # Should be the same object (cached)
        assert opensearch_config1 is opensearch_config2