import logging
import os
import string
import time
import traceback
from typing import List, Dict, Any, Tuple

from opensearchpy import NotFoundError

from backend.common.opensearch import get_opensearch_config, get_opensearch_client
from backend.common.embedding_models import get_embedding_model_factory
from backend.utils import json_dumps

log_handle = logging.getLogger(__name__)

class IndexSearcher:
    def __init__(self, config):
        """
        Initializes the IndexSearcher with OpenSearch client and configuration.

        Args:
            config: Configuration object containing OpenSearch settings.
        """
        self._config = config
        self._index_name = config.OPENSEARCH_INDEX_NAME
        self._opensearch_config = get_opensearch_config(self._config)
        self._opensearch_client = get_opensearch_client(self._config)
        log_handle.info(f"Initialized IndexSearcher for index: {self._index_name}")

        self._text_fields = {
            "hindi": "text_content_hindi",
            "gujarati": "text_content_gujarati",
            "hi": "text_content_hindi",
            "gu": "text_content_gujarati",
        }
        self._vector_field = "vector_embedding"
        self._metadata_prefix = "metadata"
        try:
            embedding_model = get_embedding_model_factory(self._config)
            self._reranker = embedding_model.get_reranking_model()
            log_handle.info(
                f"Using embedding model type '{self._config.EMBEDDING_MODEL_TYPE}' for reranking")
        except Exception:
            traceback.print_exc()
            self._reranker = None

        log_handle.info("Initialized IndexSearcher")

    def _build_category_filters(self, categories: Dict[str, List[str]]) -> List[Dict[str, Any]]:
        filters = []
        for category_key, values in categories.items():
            if not values:
                continue

            field_name = f"{self._metadata_prefix}.{category_key}.keyword"
            filters.append({
                "terms": {
                    field_name: values
                }
            })
            log_handle.debug(f"Added metadata filter: {field_name} with values {values}")
        return filters

    def _build_date_range_filter(self, start_year: int | None, end_year: int | None) -> Dict[str, Any] | None:
        """
        Builds a date range filter for OpenSearch queries.

        Returns documents where EITHER:
        1. The document has a 'date' field AND it falls within the search range, OR
        2. The document has NO 'date' field AND its series date range overlaps with the search range

        This ensures that documents with specific bookmark dates are only included if those dates
        are within range, while documents without bookmarks can be included via series date overlap.

        Args:
            start_year: Start year (e.g., 1985)
            end_year: End year (e.g., 1987)

        Returns:
            Date range filter dict with OR logic, or None if no year parameters provided
        """
        if start_year is None and end_year is None:
            return None

        # Convert years to date strings (YYYY-MM-DD format)
        search_start_date = f"{start_year}-01-01" if start_year is not None else None
        search_end_date = f"{end_year}-12-31" if end_year is not None else None

        # Build conditions for OR logic
        should_conditions = []

        # CONDITION 1: Document HAS a date field AND it's within search range
        date_exists_and_in_range = {
            "bool": {
                "must": [
                    {"exists": {"field": "date"}}
                ]
            }
        }
        date_range_condition = {"range": {"date": {}}}
        if search_start_date:
            date_range_condition["range"]["date"]["gte"] = search_start_date
        if search_end_date:
            date_range_condition["range"]["date"]["lte"] = search_end_date
        date_exists_and_in_range["bool"]["must"].append(date_range_condition)
        should_conditions.append(date_exists_and_in_range)
        log_handle.debug(f"Added document date filter (must exist and be in range): {search_start_date} to {search_end_date}")

        # CONDITION 2: Document has NO date field AND series dates overlap with search range
        # Overlap occurs when: series_start_date <= search_end_date AND series_end_date >= search_start_date
        no_date_and_series_overlap = {
            "bool": {
                "must": [
                    {"bool": {"must_not": [{"exists": {"field": "date"}}]}}
                ]
            }
        }

        if search_end_date:
            # series_start_date <= search_end_date
            no_date_and_series_overlap["bool"]["must"].append({
                "range": {
                    "metadata.series_start_date": {
                        "lte": search_end_date
                    }
                }
            })

        if search_start_date:
            # series_end_date >= search_start_date
            no_date_and_series_overlap["bool"]["must"].append({
                "range": {
                    "metadata.series_end_date": {
                        "gte": search_start_date
                    }
                }
            })

        should_conditions.append(no_date_and_series_overlap)
        log_handle.debug(f"Added series date overlap filter (only for docs without date field): series overlapping with {search_start_date} to {search_end_date}")

        # Combine with OR logic (should with minimum_should_match=1)
        date_filter = {
            "bool": {
                "should": should_conditions,
                "minimum_should_match": 1
            }
        }

        return date_filter

    def _build_lexical_query(
            self, keywords: str, exact_match: bool, exclude_words: List[str],
            categories: Dict[str, List[str]], detected_language: str,
            start_year: int | None = None, end_year: int | None = None) -> Dict[str, Any]:
        """
        Builds the OpenSearch DSL query for lexical search.
        exact_match determines if exact phrase match is used.
        exclude_words are terms to exclude from results.
        """
        query_field = self._text_fields.get(detected_language)
        if not query_field:
            log_handle.warning(
                f"Detected language '{detected_language}' not supported. "
                f"Defaulting to Hindi field.")
            query_field = 'text_content_hindi'

        log_handle.verbose(
            f"Lexical search targeting field: {query_field} for language: {detected_language}, "
            f"exact_match: {exact_match}, exclude_words: {exclude_words}")

        # Build the main query based on exact_match
        if exact_match:
            # Exact phrase match
            main_query = {
                "match_phrase": {
                    query_field: {
                        "query": keywords
                    }
                }
            }
        else:
            # Regular match with all terms
            main_query = {
                "match": {
                    query_field: {
                        "query": keywords,
                        "operator": "and"
                    }
                }
            }

        # Build highlight configuration
        highlight_config = {
            "fields": {
                query_field: {
                    "pre_tags": ["<em>"],
                    "post_tags": ["</em>"],
                    "number_of_fragments": 0,
                    "type": "unified",
                    "highlight_query": main_query
                }
            }
        }

        # Build the final query body
        bool_query = {
            "must": [main_query]
        }

        # Add exclude words as must_not clauses
        if exclude_words:
            must_not_clauses = []
            for word in exclude_words:
                must_not_clauses.append({
                    "match": {
                        query_field: word
                    }
                })
            bool_query["must_not"] = must_not_clauses
            log_handle.debug(f"Added {len(exclude_words)} exclude words to lexical query.")
        query_body = {
            "query": {
                "bool": bool_query
            },
            "highlight": highlight_config,
            "track_total_hits": 1000
        }

        # Add category filters
        category_filters = self._build_category_filters(categories)

        # Add date range filter if provided
        date_filter = self._build_date_range_filter(start_year, end_year)

        all_filters = category_filters[:]
        if date_filter:
            all_filters.append(date_filter)

        if all_filters:
            query_body["query"]["bool"]["filter"] = all_filters
            log_handle.debug(f"Added {len(all_filters)} filters to lexical query (category + date).")

        log_handle.verbose(f"Lexical query: {json_dumps(query_body)}")

        return query_body

    def _build_vector_query(
            self, embedding: List[float],
            categories: Dict[str, List[str]], size: int, language: str = None,
            start_year: int | None = None, end_year: int | None = None) -> Dict[str, Any]:
        knn_query = {
            self._vector_field: {
                "vector": embedding,
                "k": size
            }
        }

        # Build category filters
        category_filters = self._build_category_filters(categories)

        # Add language filter if specified
        all_filters = category_filters[:]
        if language and language != 'all':
            # Convert language name to language code for filtering
            language_code_map = {"hindi": "hi", "gujarati": "gu"}
            language_code = language_code_map.get(language, language)

            language_filter = {
                "term": {
                    "language": language_code
                }
            }
            all_filters.append(language_filter)
            log_handle.debug(f"Added language filter for: {language} (code: {language_code})")

        # Add date range filter if provided
        date_filter = self._build_date_range_filter(start_year, end_year)
        if date_filter:
            all_filters.append(date_filter)

        if all_filters:
            # For filtered vector search, add filters directly to the knn query
            knn_query[self._vector_field]["filter"] = {
                "bool": {
                    "filter": all_filters
                }
            }
            log_handle.debug(f"Added {len(all_filters)} total filters to vector query (category + language + date).")
        query_body = {
            "size": size,
            "query": {
                "knn": knn_query
            }
        }

        log_handle.verbose(
            f"Vector query: {json_dumps(query_body, truncate_fields=['vector'])}")
        return query_body

    def _extract_results(
            self, hits: List[Dict[str, Any]],
            is_lexical: bool = True, language=None) -> List[Dict[str, Any]]:
        extracted = []
        for hit in hits:
            source = hit.get('_source', {})
            document_id = hit.get('_id')
            score = hit.get("rerank_score", hit.get("_score"))
            content_snippet = ""

            if is_lexical:
                if language is None:
                    language = 'hi'
                field = self._text_fields.get(language)

                # Prioritise the highlighted content if available
                highlighted_fragment = hit.get('highlight', {}).get(field, [])
                if highlighted_fragment:
                    content_snippet = "...".join(highlighted_fragment)
            elif not is_lexical:
                # For vector search, we might just take a snippet of the content
                field = self._text_fields.get(language or 'hi', 'text_content_hindi')
                content_snippet = source.get(field)

            metadata = source.get(self._metadata_prefix, {})
            metadata_categories = metadata.get('categories', [])
            if not isinstance(metadata_categories, list):
                metadata_categories = [str(metadata_categories)]

            original_filename = source.get('original_filename')
            filename = os.path.basename(original_filename)

            result = {
                "document_id": document_id,
                "original_filename": source.get('original_filename'),
                "filename": filename,
                "page_number": source.get('page_number'),
                "pdf_page_number": source.get('pdf_page_number'),
                "paragraph_id": source.get('paragraph_id'),
                "content_snippet": content_snippet,
                "score": float(score) if score is not None else 0.0,
                "metadata": source.get(self._metadata_prefix, {}),
                "file_url": metadata.get("file_url", ""),
                "date": source.get('date'),
                "pravachan_number": source.get('pravachan_number'),
                "gatha": source.get('gatha'),
                "kalash": source.get('kalash'),
                "shlok": source.get('shlok'),
                "series_start_date": metadata.get('series_start_date'),
                "series_end_date": metadata.get('series_end_date')
            }
            if "Kanji" in metadata.get("Pravachankar", {}):
                # Set Pravachankar text based on language
                if language in ['gujarati', 'gu']:
                    result["Pravachankar"] = "પૂજ્ય ગુરુદેવશ્રી કાનજી સ્વામી, સોનગઢ"
                else:
                    result["Pravachankar"] = "पूज्य गुरुदेव श्री कानजी स्वामी, सोनगढ़"
            extracted.append(result)
        return extracted

    def perform_lexical_search(
            self, keywords: str, exact_match: bool, exclude_words: List[str],
            categories: Dict[str, List[str]], detected_language: str,
            page_size: int, page_number: int,
            start_year: int | None = None, end_year: int | None = None) -> Tuple[List[Dict[str, Any]], int]:
        query_body = self._build_lexical_query(keywords, exact_match,
                                               exclude_words, categories, detected_language,
                                               start_year, end_year)
        from_ = (page_number - 1) * page_size
        log_handle.verbose(f"Lexical query: {json_dumps(query_body)}")
        try:
            response = self._opensearch_client.search(
                index=self._index_name,
                body=query_body,
                size=page_size,
                from_=from_
            )
            hits = response.get('hits', {}).get('hits', [])
            total_hits = response.get('hits', {}).get('total', {}).get('value', 0)
            log_handle.info(f"Lexical search executed. Total hits: {total_hits}.")
            log_handle.info(
                f"Lexical search response: "
                f"{json_dumps(response, truncate_fields=['content_snippet', 'vector_embedding'])}")
            return (self._extract_results(hits, is_lexical=True, language=detected_language),
                    total_hits)
        except Exception as e:
            log_handle.error(f"Error during lexical search: {e}", exc_info=True)
            return [], 0

    def perform_pravachan_search(
            self, keywords: str, exact_match: bool, exclude_words: List[str],
            categories: Dict[str, List[str]], detected_language: str,
            page_size: int, page_number: int,
            start_year: int | None = None, end_year: int | None = None) -> Tuple[List[Dict[str, Any]], int]:
        """
        Performs lexical search on pravachan documents.
        Adds metadata.category = "Pravachan" filter.
        """
        # Add category filter for Pravachan
        pravachan_categories = categories.copy() if categories else {}
        if 'category' not in pravachan_categories:
            pravachan_categories['category'] = ['Pravachan']

        return self.perform_lexical_search(
            keywords=keywords,
            exact_match=exact_match,
            exclude_words=exclude_words,
            categories=pravachan_categories,
            detected_language=detected_language,
            page_size=page_size,
            page_number=page_number,
            start_year=start_year,
            end_year=end_year
        )

    def perform_granth_search(
            self, keywords: str, exact_match: bool, exclude_words: List[str],
            categories: Dict[str, List[str]], detected_language: str,
            page_size: int, page_number: int,
            start_year: int | None = None, end_year: int | None = None) -> Tuple[List[Dict[str, Any]], int]:
        """
        Performs lexical search on granth documents.
        Adds metadata.category = "Granth" filter.
        """
        # Add category filter for Granth
        granth_categories = categories.copy() if categories else {}
        if 'category' not in granth_categories:
            granth_categories['category'] = ['Granth']

        return self.perform_lexical_search(
            keywords=keywords,
            exact_match=exact_match,
            exclude_words=exclude_words,
            categories=granth_categories,
            detected_language=detected_language,
            page_size=page_size,
            page_number=page_number,
            start_year=start_year,
            end_year=end_year
        )

    def perform_vector_search(
            self, keywords: str, embedding: List[float], categories: Dict[str, List[str]],
            page_size: int, page_number: int, language: str, rerank: bool = True,
            rerank_top_k: int = 40,
            start_year: int | None = None, end_year: int | None = None) -> Tuple[List[Dict[str, Any]], int]:
        initial_fetch_size = rerank_top_k
        from_ = 0 if rerank else (page_number - 1) * page_size

        query_body = self._build_vector_query(embedding, categories, initial_fetch_size, language,
                                              start_year, end_year)
        log_handle.debug(f"Vector query: {query_body}")
        try:
            response = self._opensearch_client.search(
                index=self._index_name,
                body=query_body,
                size=initial_fetch_size,
                from_=from_
            )
            hits = response.get('hits', {}).get('hits', [])
            total_hits = response.get('hits', {}).get('total', {}).get('value', 0)
            log_handle.info(f"Vector search executed. Total hits: {total_hits}.")

            # Rerank, if required
            if not rerank or not self._reranker or not hits:
                log_handle.info(f"Vector search executed (no reranking). Total hits: {total_hits}")
                return self._extract_results(hits, is_lexical=False, language=language), total_hits

            text_field = self._text_fields.get(language, "text_content_hindi")
            log_handle.info(
                f"Performing reranking on {len(hits)} documents for query: '{keywords}'")

            # Create pairs of [query, document_text] for the reranker
            sentence_pairs = []
            for hit in hits:
                doc_text = hit["_source"].get(text_field, "")
                # Only apply text truncation - safest optimization
                truncated_text = doc_text[:1000] if len(doc_text) > 1000 else doc_text
                sentence_pairs.append([keywords, truncated_text])

            log_handle.info("--- Starting expensive reranker.predict() call... ---")
            rerank_start_time = time.time()
            # Use very small batch size for e2-medium
            rerank_scores = self._reranker.predict(
                sentence_pairs)
            rerank_duration = time.time() - rerank_start_time
            log_handle.info(
                f"--- Reranker.predict() finished. Took {rerank_duration:.2f} seconds. ---")

            for hit, score in zip(hits, rerank_scores):
                hit["rerank_score"] = score

            # Sort results based on the new reranked score
            reranked_hits = sorted(hits, key=lambda x: x["rerank_score"], reverse=True)

            # Paginate the final, sorted results
            start_index = (page_number - 1) * page_size
            end_index = start_index + page_size
            paginated_hits = reranked_hits[start_index:end_index]

            # Do not return total hits for vector search because we only care about the top-30
            # always
            return (self._extract_results(paginated_hits, is_lexical=False, language=language),
                    page_size)
        except Exception as e:
            log_handle.error(f"Error during vector search: {e}", exc_info=True)
            return [], 0

    def find_similar_by_id(self, doc_id: str, language: str, size: int = 10) \
            -> Tuple[List[Dict[str, Any]], int]:
        """
        Finds documents similar to the one with the given doc_id.
        """
        try:
            # 1. Fetch the source document to get its vector
            source_doc = self._opensearch_client.get(index=self._index_name, id=doc_id)
            source_vector = source_doc['_source'].get(self._vector_field)

            if not source_vector:
                log_handle.warning(
                    f"Document {doc_id} does not have a vector embedding. "
                    f"Cannot find similar documents.")
                return [], 0

            # 2. Build a k-NN query to find similar vectors, excluding the source document itself
            query_body = {
                "size": size,
                "query": {
                    "bool": {
                        "must": [
                            {
                                "knn": {
                                    self._vector_field: {
                                        "vector": source_vector,
                                        "k": size + 1
                                    }
                                }
                            }
                        ],
                        "must_not": [
                            {
                                "ids": {
                                    "values": [doc_id]
                                }
                            }
                        ]
                    }
                }
            }

            # 3. Execute the search
            log_handle.info(f"Finding similar documents for doc_id: {doc_id}")
            response = self._opensearch_client.search(
                index=self._index_name,
                body=query_body
            )
            hits = response.get('hits', {}).get('hits', [])

            # The total will be for the whole index, so we cap it at the number of results returned.
            effective_total = len(hits)

            log_handle.info(f"Found {effective_total} similar documents for doc_id: {doc_id}")
            return self._extract_results(hits, is_lexical=False, language=language), effective_total

        except NotFoundError:
            log_handle.error(f"Document with id '{doc_id}' not found.")
            return [], 0
        except Exception as exc:
            log_handle.error(
                f"Error finding similar documents for doc_id {doc_id}: {exc}", exc_info=True)
            return [], 0

    def get_paragraph_context(self, chunk_id: str, language: str) -> Dict[str, Any]:
        """
        Fetches the context for a given paragraph (previous, current, next)
        using a simplified and more robust two-step query process.
        """
        try:
            # Step 1: Directly fetch the current document by its unique chunk_id.
            # This is a fast lookup and avoids fragile string parsing.
            current_doc_response = self._opensearch_client.get(index=self._index_name, id=chunk_id)

            source = current_doc_response.get('_source', {})
            document_id = source.get('document_id')
            current_para_id = source.get('paragraph_id')

            if document_id is None or current_para_id is None:
                raise ValueError(
                    f"Source document for chunk_id {chunk_id} is missing "
                    f"'document_id' or 'paragraph_id'")

            current_para_id = int(current_para_id)

            # Initialize the context with the current document we already have.
            context = {
                "previous": None,
                "current": self._extract_results(
                    [current_doc_response], is_lexical=False, language=language)[0],
                "next": None
            }

            # Step 2: Build a single query to fetch only the previous and next paragraphs.
            para_ids_to_fetch = [current_para_id - 1, current_para_id + 1]
            query_body = {
                "size": 2,
                "query": {
                    "bool": {
                        "filter": [
                            {"term": {"document_id": document_id}},
                            {"terms": {"paragraph_id": para_ids_to_fetch}}
                        ]
                    }
                }
            }

            response = self._opensearch_client.search(index=self._index_name, body=query_body)
            neighbor_hits = self._extract_results(
                response.get('hits', {}).get('hits', []), is_lexical=False, language=language)
            log_handle.info(
                f"response: {json_dumps(response, truncate_fields=['vector_embedding'])}")
            log_handle.info(
                f"neighbor_hits: {json_dumps(neighbor_hits, truncate_fields=['vector_embedding'])}")
            # Step 3: Populate the context with the neighbors.
            for doc in neighbor_hits:
                para_id = int(doc.get('paragraph_id', 0))
                if para_id == current_para_id - 1:
                    context['previous'] = doc
                elif para_id == current_para_id + 1:
                    context['next'] = doc

            log_handle.info(f"Context: {json_dumps(context, truncate_fields=['vector_embedding'])}")
            return context

        except Exception as exc:
            log_handle.error(
                f"An unexpected error occurred getting paragraph context for {chunk_id}: {exc}",
                exc_info=True)
            return {}

    def get_spelling_suggestions(
            self, index_name: str, text: str, language: str,
            min_score: float = 0.6, num_suggestions: int = 3):
        """
        Gets spelling suggestions for a given text and returns a list of corrected query strings.

        Args:
            client: An instance of the OpenSearch client.
            index_name: The name of the index to query.
            text: The input string to get spelling suggestions for.
            min_score: The minimum score for a suggestion to be considered valid.
            num_suggestions: The number of alternative queries to generate.

        Returns:
            A list of corrected query strings. Returns an empty list if no corrections are found.
        """
        log_handle.info(f"Getting spelling suggestions for {text} on index {index_name}")
        if not text:
            return []

        client = get_opensearch_client(self._config)
        suggester_name = "spell-check"
        text_field = self._text_fields.get(language)

        query_body = {
            "size": 0,
            "suggest": {
                suggester_name: {
                    "text": text,
                    "term": {
                        "field": text_field,
                        "size": num_suggestions,  # Get up to N suggestions per term.
                        "sort": "score",
                        "min_word_length": 3,
                        "prefix_length": 1,
                    }
                }
            }
        }

        try:
            log_handle.info(f"Querying index '{index_name}' for suggestions on: '{text}'")
            response = client.search(
                index=index_name,
                body=query_body
            )

            # This will hold lists of suggestions for each token.
            # e.g., [['कुंदकुंदाचार्य'], ['सीमंधर', 'सीमंघर']]
            token_suggestions = []
            has_any_correction = False

            if "suggest" in response and suggester_name in response["suggest"]:
                for suggestion_part in response["suggest"][suggester_name]:
                    original_token = suggestion_part["text"]

                    # Filter suggestions by score
                    valid_options = [
                        opt['text'] for opt in suggestion_part.get("options", [])
                        if opt['score'] >= min_score
                    ]

                    if valid_options:
                        token_suggestions.append(valid_options)
                        has_any_correction = True
                    else:
                        # If no valid suggestions, use the original token
                        token_suggestions.append([original_token])

            if not has_any_correction:
                return []

            # Construct the final list of suggested queries
            final_suggestions = []
            for i in range(num_suggestions):
                new_query_tokens = []
                for suggestions_for_token in token_suggestions:
                    # Use the i-th suggestion if available, otherwise fall back to the best one (0).
                    suggestion_index = min(i, len(suggestions_for_token) - 1)
                    new_query_tokens.append(suggestions_for_token[suggestion_index])

                new_query = " ".join(new_query_tokens)
                if new_query not in final_suggestions:
                    final_suggestions.append(new_query)

            return final_suggestions

        except Exception as e:
            traceback.print_exc()
            return []

    def is_lexical_query(self, query_string: str) -> bool:
        """
        Checks if a query is "lexical," with special handling for Hindi.
        """
        # Define a set of punctuation including standard English and Hindi marks.
        # The "।" (danda/purna viram) is the Hindi full stop.
        # The "॥" (double danda) is also included for completeness.
        all_punctuation = set(string.punctuation) | {"।", "॥"}

        has_punctuation = any(char in all_punctuation for char in query_string)
        if has_punctuation:
            return False

        word_count = len(query_string.split())
        if word_count >= 4:
            return False

        return True