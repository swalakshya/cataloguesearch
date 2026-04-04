from backend.api.agent.router import _extract_file_url_from_bucket


def test_extract_file_url_from_bucket():
    bucket = {
        "file_url_hit": {
            "hits": {
                "hits": [
                    {"_source": {"metadata": {"file_url": "https://example.com/a.pdf"}}}
                ]
            }
        }
    }
    assert _extract_file_url_from_bucket(bucket) == "https://example.com/a.pdf"


def test_extract_file_url_missing():
    bucket = {"file_url_hit": {"hits": {"hits": []}}}
    assert _extract_file_url_from_bucket(bucket) is None
