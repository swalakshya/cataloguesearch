from typing import List


def fetch_file_urls(opensearch_client, index_name: str, page_size: int = 1000) -> List[str]:
    urls: List[str] = []
    after_key = None

    while True:
        composite = {
            "size": page_size,
            "sources": [
                {"file_url": {"terms": {"field": "metadata.file_url.keyword"}}}
            ],
        }
        if after_key:
            composite["after"] = after_key

        body = {
            "size": 0,
            "aggs": {"file_urls": {"composite": composite}},
        }
        response = opensearch_client.search(index=index_name, body=body)
        agg = response.get("aggregations", {}).get("file_urls", {})
        buckets = agg.get("buckets", [])
        for bucket in buckets:
            key = bucket.get("key", {})
            url = key.get("file_url")
            if url:
                urls.append(url)

        after_key = agg.get("after_key")
        if not after_key:
            break

    return urls
