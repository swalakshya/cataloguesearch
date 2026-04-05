from backend.url_shortener.opensearch_loader import fetch_file_urls


class FakeClient:
    def __init__(self):
        self.calls = 0

    def search(self, index, body):
        self.calls += 1
        if self.calls == 1:
            return {
                "aggregations": {
                    "file_urls": {
                        "buckets": [
                            {"key": {"file_url": "https://a.pdf"}},
                            {"key": {"file_url": "https://b.pdf"}},
                        ],
                        "after_key": {"file_url": "https://b.pdf"},
                    }
                }
            }
        return {
            "aggregations": {
                "file_urls": {
                    "buckets": [
                        {"key": {"file_url": "https://c.pdf"}},
                    ],
                }
            }
        }


def test_fetch_file_urls_pages_through_composite():
    client = FakeClient()
    urls = fetch_file_urls(client, index_name="cataloguesearch_prod")
    assert urls == ["https://a.pdf", "https://b.pdf", "https://c.pdf"]
    assert client.calls == 2
