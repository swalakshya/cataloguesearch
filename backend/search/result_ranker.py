import logging
from typing import List, Dict, Any, Tuple
from collections import defaultdict

log_handle = logging.getLogger(__name__)

class ResultRanker:
    """
    A utility class for collating and ranking search results from different sources
    (e.g., lexical and vector search).
    """

    @staticmethod
    def _normalize_score(score: float, max_score: float) -> float:
        """
        Normalizes a score to a 0-1 range based on a maximum score.
        Avoids division by zero.
        """
        if max_score == 0:
            return 0.0
        return score / max_score

    @staticmethod
    def collate_and_rank(
            lexical_results: List[Dict[str, Any]],
            vector_results: List[Dict[str, Any]],
            page_size: int,
            page_number: int
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Combines and ranks results from lexical and vector searches.
        Currently uses a simple weighted sum after normalization.
        Can be extended to use more sophisticated methods like RRF.

        Args:
            lexical_results (List[Dict[str, Any]]): Results from lexical search.
            vector_results (List[Dict[str, Any]]): Results from vector search.
            page_size (int): Desired number of results per page.
            page_number (int): Desired page number.

        Returns:
            Tuple[List[Dict[str, Any]], int]: A tuple containing:
                - List of combined and ranked results (paginated).
                - Total number of unique results before pagination.
        """
        combined_results_map: Dict[str, Dict[str, Any]] = defaultdict(dict)
        all_scores: List[float] = []

        # Collect all unique document_id + page_number combinations
        # and store their highest scores from each source
        for res_list, source_type in [(lexical_results, 'lexical'), (vector_results, 'vector')]:
            for res in res_list:
                doc_page_id = f"{res.get('document_id')}-{res.get('page_number')}"
                current_score = res.get('score', 0.0)

                if doc_page_id not in combined_results_map:
                    combined_results_map[doc_page_id] = res
                    combined_results_map[doc_page_id]['lexical_score'] = 0.0
                    combined_results_map[doc_page_id]['vector_score'] = 0.0

                # Update the specific source score if it's higher
                if source_type == 'lexical':
                    combined_results_map[doc_page_id]['lexical_score'] = max(
                        combined_results_map[doc_page_id]['lexical_score'], current_score)
                elif source_type == 'vector':
                    combined_results_map[doc_page_id]['vector_score'] = max(
                        combined_results_map[doc_page_id]['vector_score'], current_score)

                all_scores.append(current_score)


        # Determine max scores for normalization
        max_lexical_score = (max(res.get('lexical_score', 0.0) 
                                 for res in combined_results_map.values()) 
                             if combined_results_map else 0.0)
        max_vector_score = (max(res.get('vector_score', 0.0) 
                                for res in combined_results_map.values()) 
                            if combined_results_map else 0.0)

        # Calculate combined scores
        final_ranked_list = []
        for doc_page_id, res in combined_results_map.items():
            # Normalize individual scores
            normalized_lexical_score = ResultRanker._normalize_score(
                res.get('lexical_score', 0.0), max_lexical_score)
            normalized_vector_score = ResultRanker._normalize_score(
                res.get('vector_score', 0.0), max_vector_score)

            # Simple weighted sum (can be tuned)
            # You might want to adjust these weights based on empirical testing
            combined_score = ((0.6 * normalized_lexical_score) + 
                              (0.4 * normalized_vector_score))
            res['score'] = combined_score  # Overwrite the original score with the combined score
            final_ranked_list.append(res)

        # Sort by combined score in descending order
        final_ranked_list.sort(key=lambda x: x['score'], reverse=True)

        total_unique_results = len(final_ranked_list)

        # Apply pagination
        start_index = (page_number - 1) * page_size
        end_index = start_index + page_size
        paginated_results = final_ranked_list[start_index:end_index]

        log_handle.info(f"Collated and ranked {total_unique_results} unique results. "
                        f"Returning page {page_number} (size {page_size}).")
        return paginated_results, total_unique_results

    @staticmethod
    def rrf_rank(
            lexical_results: List[Dict[str, Any]],
            vector_results: List[Dict[str, Any]],
            k: int = 60,
    ) -> List[Dict[str, Any]]:
        """
        Reciprocal Rank Fusion of lexical and vector result lists.

        Score for each chunk: sum of 1/(k + rank) across whichever lists it
        appears in. Rank is 1-indexed. Chunks absent from a list contribute 0
        for that list — they are naturally penalised relative to chunks that
        rank well in both.

        Deduplication key is document_id (chunk-level), so two chunks from the
        same document but different paragraphs are kept separate, which is the
        correct behaviour for passage retrieval.

        Args:
            lexical_results: BM25-ranked list of result dicts.
            vector_results:  kNN-ranked list of result dicts (raw order, not reranked).
            k: Dampening constant. Default 60 is standard in the RRF literature.

        Returns:
            Single fused list sorted by descending RRF score. Each entry has
            'score' set to the RRF value, plus 'lexical_score' and
            'vector_score' showing the original per-source scores for debugging.
        """
        fused_scores: Dict[str, float] = defaultdict(float)
        doc_data: Dict[str, Dict[str, Any]] = {}

        for rank, result in enumerate(lexical_results):
            doc_id = result.get("document_id")
            if not doc_id:
                continue
            fused_scores[doc_id] += 1.0 / (k + rank + 1)
            if doc_id not in doc_data:
                doc_data[doc_id] = dict(result)
                doc_data[doc_id]["lexical_score"] = 0.0
                doc_data[doc_id]["vector_score"] = 0.0
            doc_data[doc_id]["lexical_score"] = result.get("score", 0.0)

        for rank, result in enumerate(vector_results):
            doc_id = result.get("document_id")
            if not doc_id:
                continue
            fused_scores[doc_id] += 1.0 / (k + rank + 1)
            if doc_id not in doc_data:
                doc_data[doc_id] = dict(result)
                doc_data[doc_id]["lexical_score"] = 0.0
                doc_data[doc_id]["vector_score"] = 0.0
            doc_data[doc_id]["vector_score"] = result.get("score", 0.0)

        for doc_id, rrf_score in fused_scores.items():
            doc_data[doc_id]["score"] = rrf_score

        ranked = sorted(doc_data.values(), key=lambda x: x["score"], reverse=True)
        log_handle.info(
            "RRF: %d lexical + %d vector → %d unique chunks fused (k=%d).",
            len(lexical_results), len(vector_results), len(ranked), k,
        )
        return ranked