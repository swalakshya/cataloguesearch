"""
Paragraph size utilities — sentence splitting and max-word splitting.

Provides:
  split_into_sentences  — tokenise text into sentence-terminated units
  split_long_para       — split a single ParaInfo at sentence boundaries
"""
from __future__ import annotations

import re

from backend.crawler.paragraph_generator.base import ParaInfo

# Matches verse-number markers at end of text, e.g. ।।3।।
ABSOLUTE_TERM_RE = re.compile(r'।।\d+।।\s*$')


def split_into_sentences(text: str, terminators: tuple) -> list[str]:
    """
    Split text into sentence-terminated units.
    The terminator stays attached to the preceding sentence.
    Longer terminators are matched before shorter ones (e.g. '।।' before '।').
    """
    if not text:
        return []

    sorted_terms = sorted(terminators, key=len, reverse=True)
    sentences: list[str] = []
    start = 0
    i = 0
    n = len(text)

    while i < n:
        for term in sorted_terms:
            tlen = len(term)
            if text[i:i + tlen] == term:
                sentences.append(text[start:i + tlen])
                start = i + tlen
                i = start
                break
        else:
            i += 1

    if start < n:
        sentences.append(text[start:])

    return [s for s in sentences if s.strip()]


def _page_at_word(page_spans: list, word_offset: int) -> int:
    """Return the page number that contains the given word offset."""
    page = page_spans[0][0]
    for pn, offset in page_spans:
        if offset <= word_offset:
            page = pn
        else:
            break
    return page


def _slice_page_spans(page_spans: list, start: int, end: int) -> list:
    """
    Return the subset of page_spans covering word range [start, end),
    with offsets re-zeroed relative to start.
    """
    result: list = []
    for pn, offset in page_spans:
        if offset >= end:
            break
        if offset <= start:
            result = [(pn, 0)]
        else:
            result.append((pn, offset - start))
    return result


def split_long_para(
    para: ParaInfo,
    max_words: int,
    terminators: tuple,
) -> list[ParaInfo]:
    """
    Split a single ParaInfo at sentence boundaries if it exceeds max_words.
    Returns [para] unchanged if already within limit or cannot be split further.
    Soft limit: a single sentence exceeding max_words is emitted as-is.

    Metadata propagation:
      is_chapter_start → first chunk only
      is_verse_end     → last chunk only
      is_question / is_answer → all chunks
    """
    if len(para.text.split()) <= max_words:
        return [para]

    sentences = split_into_sentences(para.text, terminators)
    if len(sentences) <= 1:
        return [para]

    sent_wcs = [len(s.split()) for s in sentences]

    # Greedy packing: build groups of sentence indices
    groups: list[tuple[int, int, int]] = []  # (sent_start, sent_end, word_offset)
    chunk_start = 0
    chunk_wc = 0
    word_offset = 0

    for i, wc in enumerate(sent_wcs):
        if chunk_wc > 0 and chunk_wc + wc > max_words:
            groups.append((chunk_start, i, word_offset))
            word_offset += chunk_wc
            chunk_start = i
            chunk_wc = 0
        chunk_wc += wc

    if chunk_start < len(sentences):
        groups.append((chunk_start, len(sentences), word_offset))

    if len(groups) <= 1:
        return [para]

    result: list[ParaInfo] = []
    for gi, (si, ei, start_word) in enumerate(groups):
        is_first = (gi == 0)
        is_last = (gi == len(groups) - 1)
        chunk_text = "".join(sentences[si:ei]).strip()
        chunk_wc = sum(sent_wcs[si:ei])

        if para.page_spans:
            chunk_page = _page_at_word(para.page_spans, start_word)
            chunk_spans = _slice_page_spans(para.page_spans, start_word, start_word + chunk_wc)
        else:
            chunk_page = para.page_num
            chunk_spans = [(para.page_num, 0)]

        result.append(ParaInfo(
            page_num=chunk_page,
            text=chunk_text,
            page_spans=chunk_spans,
            is_chapter_start=para.is_chapter_start and is_first,
            is_verse_end=para.is_verse_end and is_last,
            is_question=para.is_question,
            is_answer=para.is_answer,
        ))

    return result
