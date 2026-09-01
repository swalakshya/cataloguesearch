import React, { useState } from 'react';
import { SimilarIcon, ExpandIcon, PdfIcon, ShareIcon } from './SharedComponents';
import ShareModal from './ShareModal';
import { Badge, Pagination as UiPagination, Skeleton } from './ui';
import { CATEGORY_EMOJI_SRC } from './chat/categoryEmoji';

// --- SEARCH RESULTS COMPONENTS ---

const highlightSnippet = (content, extraClass = '') =>
    ({ __html: (content || '').replace(/<em>/g, `<mark class="search-highlight ${extraClass}">`).replace(/<\/em>/g, '</mark>') });

// Granth Result Card for displaying scripture verses
export const GranthResultCard = ({ result, isFirst }) => {
    const cardClasses = isFirst
        ? "card p-4"
        : "card p-3 transition-shadow hover:shadow-sm";
    const cardStyle = isFirst ? { borderWidth: 2, borderColor: 'var(--color-brand)' } : undefined;

    const granth = result;
    const verses = granth.verses || [];

    return (
        <div className={cardClasses} style={cardStyle}>
            {/* Granth Header */}
            <div className="border-b border-border pb-2 mb-3">
                <h3 className="text-lg font-bold text-ink mb-1">{granth.name}</h3>
                <div className="text-sm text-ink-muted flex flex-wrap gap-x-3 gap-y-1">
                    {granth.metadata?.language && <span>Language: {granth.metadata.language}</span>}
                    {granth.metadata?.author && <span>Author: {granth.metadata.author}</span>}
                    {granth.metadata?.anuyog && <span>Anuyog: {granth.metadata.anuyog}</span>}
                    {granth.original_filename && <span className="text-ink">{granth.original_filename}</span>}
                    {granth.metadata?.file_url && (
                        <a
                            href={granth.metadata.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand hover:text-brand-hover font-medium flex items-center"
                        >
                            <PdfIcon />View PDF
                        </a>
                    )}
                </div>
            </div>

            {/* Verses */}
            <div className="space-y-4">
                {verses.map((verse, index) => (
                    <div key={index} className="border-l-4 pl-3" style={{ borderColor: 'color-mix(in srgb, var(--color-brand) 25%, var(--color-border))' }}>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="font-bold text-ink">{granth.name}</span>
                            {verse.adhikar && (
                                <span className="font-bold text-ink">Adhikar: {verse.adhikar}</span>
                            )}
                            {verse.type && verse.type_start_num !== undefined && verse.type_end_num !== undefined && (
                                <span className="text-ink">
                                    Verse Type ({verse.type}): {verse.type_start_num === verse.type_end_num
                                        ? verse.type_start_num
                                        : `${verse.type_start_num}-${verse.type_end_num}`}
                                </span>
                            )}
                            {verse.page_num && (
                                <span className="text-ink">Page Number: {verse.page_num}</span>
                            )}
                            {granth.metadata?.file_url && (
                                <a
                                    href={granth.metadata.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand hover:text-brand-hover font-medium flex items-center"
                                >
                                    <PdfIcon />View PDF
                                </a>
                            )}
                        </div>

                        {verse.verse && (
                            <div className="mb-2">
                                <p className="text-base font-semibold text-ink leading-relaxed whitespace-pre-wrap">{verse.verse}</p>
                            </div>
                        )}

                        {verse.translation && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-ink mb-1">Translation:</p>
                                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{verse.translation}</p>
                            </div>
                        )}

                        {verse.meaning && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-ink mb-1">Meaning:</p>
                                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{verse.meaning}</p>
                            </div>
                        )}

                        {verse.teeka && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-ink mb-1">Teeka:</p>
                                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{verse.teeka}</p>
                            </div>
                        )}

                        {verse.bhavarth && (
                            <div>
                                <p className="text-sm font-medium text-ink mb-1">Bhavarth:</p>
                                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{verse.bhavarth}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const MetaItem = ({ children }) => <span className="text-ink-muted text-xs">{children}</span>;

export const ResultCard = ({ result, onFindSimilar, onExpand, onExpandGranth, resultType, isFirst, query, currentFilters, language, searchType, compact }) => {
    const [showShareModal, setShowShareModal] = useState(false);

    const cardClasses = `card ${compact ? 'p-2' : 'p-3'} hover:shadow-sm transition-shadow`;

    const handleExpandClick = () => {
        if (resultType === 'granth') {
            // For structured Granth results with seq_num, use the granth expand path
            const originalFilename = result.original_filename;
            const verseSeqNum = result.metadata?.verse_seq_num;
            const proseSeqNum = result.metadata?.prose_seq_num;

            if (originalFilename && verseSeqNum !== undefined && onExpandGranth) {
                onExpandGranth(originalFilename, verseSeqNum, 'verse');
            } else if (originalFilename && proseSeqNum !== undefined && onExpandGranth) {
                onExpandGranth(originalFilename, proseSeqNum, 'prose');
            } else if (onExpand) {
                // Paragraph chunks from search_index — same context path as Pravachan
                onExpand(result.document_id);
            }
        } else {
            // For Pravachan and other results, use document_id
            if (onExpand) {
                onExpand(result.document_id);
            }
        }
    };

    return (
        <div className={cardClasses}>
            {/* Single header row: metadata left, actions right */}
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-border">
                {/* Metadata */}
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline flex-1 min-w-0">
                    {result.metadata?.Name && <span className="text-ink font-semibold text-[0.8rem]">{result.metadata.Name}</span>}
                    {result.metadata?.sub_section && (
                        <MetaItem>({result.metadata.sub_section.name})</MetaItem>
                    )}
                    {result.metadata?.title && resultType === 'granth' && <span className="text-ink font-semibold text-[0.8rem]">{result.metadata.title}</span>}
                    {resultType === 'granth' && result.metadata?.adhikar && (
                        <MetaItem>Adhikar: {result.metadata.adhikar}</MetaItem>
                    )}
                    {resultType === 'granth' && result.metadata?.verse_type && result.metadata?.verse_type_start_num !== undefined && result.metadata?.verse_type_end_num !== undefined && (
                        <MetaItem>
                            {result.metadata.verse_type}: {result.metadata.verse_type_start_num === result.metadata.verse_type_end_num
                                ? result.metadata.verse_type_start_num
                                : `${result.metadata.verse_type_start_num}-${result.metadata.verse_type_end_num}`}
                        </MetaItem>
                    )}
                    {resultType === 'granth' && result.metadata?.Author && (
                        <MetaItem>· {result.metadata.Author}</MetaItem>
                    )}
                    {result.metadata?.Series && <MetaItem>· {result.metadata.Series}</MetaItem>}
                    {resultType === 'granth' ? (
                        <>
                            {result.chunk_labels?.gatha && <MetaItem>· Gatha: {result.chunk_labels.gatha}</MetaItem>}
                            {result.chunk_labels?.kalash && <MetaItem>· Kalash: {result.chunk_labels.kalash}</MetaItem>}
                            {result.chunk_labels?.shlok && <MetaItem>· Shlok: {result.chunk_labels.shlok}</MetaItem>}
                            {result.chunk_labels?.doha && <MetaItem>· Doha: {result.chunk_labels.doha}</MetaItem>}
                            {result.chunk_labels?.kavya && <MetaItem>· Kavya: {result.chunk_labels.kavya}</MetaItem>}
                            {result.chunk_labels?.sutra && <MetaItem>· Sutra: {result.chunk_labels.sutra}</MetaItem>}
                        </>
                    ) : (
                        <>
                            {result.metadata?.volume && <MetaItem>· Vol. {result.metadata.volume}</MetaItem>}
                            {result.chunk_labels?.date && <MetaItem>· {result.chunk_labels.date}</MetaItem>}
                            {result.chunk_labels?.pravachan_number && <MetaItem>· Pravachan No. {result.chunk_labels.pravachan_number}</MetaItem>}
                            {result.chunk_labels?.gatha && <MetaItem>· Gatha: {result.chunk_labels.gatha}</MetaItem>}
                            {result.chunk_labels?.kalash && <MetaItem>· Kalash: {result.chunk_labels.kalash}</MetaItem>}
                            {result.chunk_labels?.shlok && <MetaItem>· Shlok: {result.chunk_labels.shlok}</MetaItem>}
                            {result.chunk_labels?.doha && <MetaItem>· Doha: {result.chunk_labels.doha}</MetaItem>}
                            {result.chunk_labels?.kavya && <MetaItem>· Kavya: {result.chunk_labels.kavya}</MetaItem>}
                            {result.chunk_labels?.sutra && <MetaItem>· Sutra: {result.chunk_labels.sutra}</MetaItem>}
                            {!result.metadata?.volume && !result.chunk_labels?.date && !result.chunk_labels?.pravachan_number && !result.chunk_labels?.gatha && !result.chunk_labels?.kalash && !result.chunk_labels?.shlok && !result.chunk_labels?.doha && !result.chunk_labels?.kavya && !result.chunk_labels?.sutra && (
                                <MetaItem>· {result.filename}</MetaItem>
                            )}
                            <MetaItem>· Page No. {result.page_number}</MetaItem>
                        </>
                    )}
                </div>
                {/* Actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    {result.file_url && (
                        <a
                            href={`${result.file_url}#page=${result.pdf_page_number ?? result.page_number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="result-action result-action-danger"
                        >
                            <PdfIcon />PDF
                        </a>
                    )}
                    <button onClick={() => setShowShareModal(true)} className="result-action">
                        <ShareIcon />Share
                    </button>
                    <button onClick={handleExpandClick} className="result-action">
                        <ExpandIcon />Expand
                    </button>
                    {resultType !== 'granth' && (
                        <button onClick={() => onFindSimilar(result)} className="result-action">
                            <SimilarIcon />Similar
                        </button>
                    )}
                </div>
            </div>
            <div className={`text-base text-ink ${compact ? 'leading-snug' : 'leading-relaxed'} font-sans`}>
                <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={highlightSnippet(result.content_snippet)} />
            </div>

            {showShareModal && (
                <ShareModal
                    result={result}
                    query={query}
                    currentFilters={currentFilters}
                    language={language}
                    searchType={searchType}
                    onClose={() => setShowShareModal(false)}
                />
            )}
        </div>
    );
};

const TabSpinner = () => (
    <svg className="w-3.5 h-3.5 animate-spin text-ink-muted" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
);

const CategoryTabButton = ({ active, isLoading, onClick, emojiSrc, label, count }) => (
    <button
        onClick={onClick}
        className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        style={{
            borderColor: active ? 'var(--color-brand)' : 'transparent',
            color: isLoading ? 'var(--color-ink-muted)' : active ? 'var(--color-brand)' : 'var(--color-ink)',
        }}
    >
        {isLoading ? <TabSpinner /> : <img src={emojiSrc} alt="" className="w-4 h-4" />}
        {label}
        <Badge variant={active ? 'brand' : 'neutral'}>{isLoading ? '…' : count}</Badge>
    </button>
);

export const Tabs = ({ activeTab, setActiveTab, searchData, similarDocumentsData, onClearSimilar, loadingCategories, activeCategories }) => {
    const pravachanCount = searchData?.pravachan_results?.total_hits || 0;
    const granthCount = searchData?.granth_results?.total_hits || 0;
    const booksCount = searchData?.books_results?.total_hits || 0;
    const similarCount = similarDocumentsData?.total_results || 0;
    const hasSuggestions = searchData?.suggestions && searchData.suggestions.length > 0;
    const isLoadingPravachan = loadingCategories?.has('Pravachan');
    const isLoadingGranth = loadingCategories?.has('Granth');
    const isLoadingBooks = loadingCategories?.has('Books');
    const anyLoading = loadingCategories?.size > 0;

    const hasAnyResults = (!hasSuggestions && (pravachanCount > 0 || granthCount > 0 || booksCount > 0)) || similarDocumentsData;
    const showPravachan = !hasSuggestions && (isLoadingPravachan || pravachanCount > 0);
    const showGranth = !hasSuggestions && (isLoadingGranth || granthCount > 0);
    const showBooks = !hasSuggestions && (isLoadingBooks || booksCount > 0);

    if (!anyLoading && !hasAnyResults) return null;

    return (
        <div className="flex items-center border-b border-border bg-surface px-3 rounded-t">
            {showPravachan && (
                <CategoryTabButton
                    active={activeTab === 'pravachan'}
                    isLoading={isLoadingPravachan}
                    onClick={() => setActiveTab('pravachan')}
                    emojiSrc={CATEGORY_EMOJI_SRC.Pravachan}
                    label="Pravachan"
                    count={pravachanCount}
                />
            )}
            {showGranth && (
                <CategoryTabButton
                    active={activeTab === 'granth'}
                    isLoading={isLoadingGranth}
                    onClick={() => setActiveTab('granth')}
                    emojiSrc={CATEGORY_EMOJI_SRC.Granth}
                    label="Granth"
                    count={granthCount}
                />
            )}
            {showBooks && (
                <CategoryTabButton
                    active={activeTab === 'books'}
                    isLoading={isLoadingBooks}
                    onClick={() => setActiveTab('books')}
                    emojiSrc={CATEGORY_EMOJI_SRC.Books}
                    label="Books"
                    count={booksCount}
                />
            )}
            {similarDocumentsData && (
                <button
                    onClick={() => setActiveTab('similar')}
                    className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
                    style={{
                        borderColor: activeTab === 'similar' ? 'var(--color-brand)' : 'transparent',
                        color: activeTab === 'similar' ? 'var(--color-brand)' : 'var(--color-ink)',
                    }}
                >
                    More Like This
                    <Badge variant={activeTab === 'similar' ? 'brand' : 'neutral'}>{similarCount}</Badge>
                    <span
                        onClick={(e) => { e.stopPropagation(); onClearSimilar(); }}
                        className="text-danger hover:opacity-75 font-bold text-base ml-1 leading-none"
                    >
                        &times;
                    </span>
                </button>
            )}
        </div>
    );
};

export const SuggestionsCard = ({ suggestions, originalQuery, onSuggestionClick, hasResults }) => {
    // If there are results, don't show this card at all
    if (hasResults) return null;

    // If there are no results and no suggestions, show simple "no results" message
    if (!suggestions || suggestions.length === 0) {
        return (
            <div className="card p-4 mb-4">
                <div className="text-base text-ink text-center">
                    <p>No results found for "<span className="font-bold text-ink">{originalQuery}</span>".</p>
                    <p className="text-sm text-ink-muted mt-2">Try different keywords or adjust your filters.</p>
                </div>
            </div>
        );
    }

    // If there are suggestions, show them
    return (
        <div className="notice notice-warning mb-4">
            <div className="text-base">
                <p className="mb-3">
                    No results found for "<span className="font-bold text-danger">{originalQuery}</span>".
                </p>
                <p>
                    Did you mean:
                    <span className="inline-flex flex-wrap items-center gap-2 ml-2">
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={index}
                                onClick={() => onSuggestionClick(suggestion)}
                                className="suggestion-chip inline-flex items-center px-3 py-1 text-sm rounded transition-colors font-semibold"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </span>
                    ?
                </p>
            </div>
        </div>
    );
};

export const SimilarSourceInfoCard = ({ sourceDoc }) => {
    if (!sourceDoc) return null;

    return (
        <div className="notice notice-info mb-3">
            <h3 className="font-semibold text-sm mb-1.5">Showing results similar to:</h3>
            <div className="text-sm mb-2">
                <span className="font-medium">{sourceDoc.original_filename}</span>
                <span className="ml-3">Page: {sourceDoc.page_number}</span>
            </div>
            <blockquote className="border-l-4 pl-2 text-base italic text-ink font-sans" style={{ borderColor: 'color-mix(in srgb, var(--color-info) 45%, var(--color-border))' }}>
                <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={highlightSnippet(sourceDoc.content_snippet)} />
            </blockquote>
        </div>
    );
};

export const ResultsList = ({ results, totalResults, pageSize, currentPage, onPageChange, resultType, onFindSimilar, onExpand, onExpandGranth, searchType, query, currentFilters, language, compact }) => {
    const totalPages = Math.ceil(totalResults / pageSize);

    return (
        <div className="bg-surface p-3 md:p-4">
            <div className={compact ? 'space-y-1.5' : 'space-y-3'}>
                {results.map((result, index) => (
                    <ResultCard
                        key={`${resultType}-${result.document_id}`}
                        result={result}
                        onFindSimilar={onFindSimilar}
                        onExpand={onExpand}
                        onExpandGranth={onExpandGranth}
                        resultType={resultType}
                        isFirst={currentPage === 1 && index === 0}
                        query={query}
                        currentFilters={currentFilters}
                        language={language}
                        searchType={searchType}
                        compact={compact}
                    />
                ))}
            </div>
            <UiPagination page={currentPage} totalPages={totalPages} onPageChange={onPageChange} className="justify-center mt-4" />
        </div>
    );
};

export const GranthResultsList = ({ results, totalResults, pageSize, currentPage, onPageChange }) => {
    const totalPages = Math.ceil(totalResults / pageSize);

    return (
        <div className="bg-surface p-3 md:p-4 rounded-b-md">
            <div className="text-sm text-ink-muted mb-3">Showing {results.length} of {totalResults} granth results.</div>
            <div className="space-y-3">
                {results.map((result, index) => (
                    <GranthResultCard
                        key={`granth-${result.granth_id || index}`}
                        result={result}
                        isFirst={currentPage === 1 && index === 0}
                    />
                ))}
            </div>
            <UiPagination page={currentPage} totalPages={totalPages} onPageChange={onPageChange} className="justify-center mt-4" />
        </div>
    );
};

const SkeletonCard = ({ wide }) => (
    <div className="card p-3">
        <div className="flex gap-3 mb-2 pb-2 border-b border-border items-center">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-20" />
            <div className="ml-auto flex gap-2">
                <Skeleton className="h-2.5 w-10" />
                <Skeleton className="h-2.5 w-14" />
            </div>
        </div>
        <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3" style={{ width: wide ? '70%' : '85%' }} />
        </div>
    </div>
);

export const SkeletonResultsList = () => (
    <div className="mt-4 space-y-2.5">
        {[false, true, false, true, false].map((wide, i) => <SkeletonCard key={i} wide={wide} />)}
    </div>
);
