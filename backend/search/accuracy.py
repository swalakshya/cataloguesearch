"""Per-request accuracy options; never mutate shared search configuration."""

ACCURACY_CANDIDATES = 100


def candidate_count(accuracy_mode: bool, standard_count: int) -> int:
    return ACCURACY_CANDIDATES if accuracy_mode else standard_count


def rerank_timeout(accuracy_mode: bool) -> int:
    return 60 if accuracy_mode else 40
