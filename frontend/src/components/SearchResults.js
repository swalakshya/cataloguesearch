import React, { useState } from 'react';
import { SimilarIcon, ExpandIcon, PdfIcon, ShareIcon } from './SharedComponents';
import ShareModal from './ShareModal';

// --- SEARCH RESULTS COMPONENTS ---

// Granth Result Card for displaying scripture verses
export const GranthResultCard = ({ result, isFirst }) => {
    const cardClasses = isFirst
        ? "bg-white p-4 rounded-lg border-2 border-sky-500 shadow-md"
        : "bg-white p-3 rounded-md border border-slate-200 transition-shadow hover:shadow-sm";

    const granth = result;
    const verses = granth.verses || [];

    return (
        <div className={cardClasses}>
            {/* Granth Header */}
            <div className="border-b border-slate-200 pb-2 mb-3">
                <h3 className="text-lg font-bold text-slate-800 mb-1">{granth.name}</h3>
                <div className="text-sm text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                    {granth.metadata?.language && <span>Language: {granth.metadata.language}</span>}
                    {granth.metadata?.author && <span>Author: {granth.metadata.author}</span>}
                    {granth.metadata?.anuyog && <span>Anuyog: {granth.metadata.anuyog}</span>}
                    {granth.original_filename && <span className="text-slate-800">{granth.original_filename}</span>}
                    {granth.metadata?.file_url && (
                        <a
                            href={granth.metadata.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 font-medium flex items-center"
                        >
                            <PdfIcon />View PDF
                        </a>
                    )}
                </div>
            </div>

            {/* Verses */}
            <div className="space-y-4">
                {verses.map((verse, index) => (
                    <div key={index} className="border-l-4 border-sky-200 pl-3">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="font-bold text-slate-800">{granth.name}</span>
                            {verse.adhikar && (
                                <span className="font-bold text-slate-900">Adhikar: {verse.adhikar}</span>
                            )}
                            {verse.type && verse.type_start_num !== undefined && verse.type_end_num !== undefined && (
                                <span className="text-slate-900">
                                    Verse Type ({verse.type}): {verse.type_start_num === verse.type_end_num
                                        ? verse.type_start_num
                                        : `${verse.type_start_num}-${verse.type_end_num}`}
                                </span>
                            )}
                            {verse.page_num && (
                                <span className="text-slate-900">Page Number: {verse.page_num}</span>
                            )}
                            {granth.metadata?.file_url && (
                                <a
                                    href={granth.metadata.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 font-medium flex items-center"
                                >
                                    <PdfIcon />View PDF
                                </a>
                            )}
                        </div>

                        {verse.verse && (
                            <div className="mb-2">
                                <p className="text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-wrap">{verse.verse}</p>
                            </div>
                        )}

                        {verse.translation && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-slate-800 mb-1">Translation:</p>
                                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{verse.translation}</p>
                            </div>
                        )}

                        {verse.meaning && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-slate-800 mb-1">Meaning:</p>
                                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{verse.meaning}</p>
                            </div>
                        )}

                        {verse.teeka && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-slate-800 mb-1">Teeka:</p>
                                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{verse.teeka}</p>
                            </div>
                        )}

                        {verse.bhavarth && (
                            <div>
                                <p className="text-sm font-medium text-slate-800 mb-1">Bhavarth:</p>
                                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{verse.bhavarth}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export const ResultCard = ({ result, onFindSimilar, onExpand, onExpandGranth, resultType, isFirst, query, currentFilters, language, searchType, compact }) => {
    const [showShareModal, setShowShareModal] = useState(false);
    const getHighlightedHTML = () => {
        const content = result.content_snippet || '';
        // CORRECTED: The highlight class is now consistently `bg-sky-200` for all results to ensure visibility.
        return { __html: content.replace(/<em>/g, `<mark class="bg-sky-200 text-slate-800 px-1 rounded">`).replace(/<\/em>/g, '</mark>') };
    };

    const cardClasses = `bg-white ${compact ? 'p-2' : 'p-3'} rounded border border-slate-200 hover:border-slate-300 transition-colors`;
    const cardStyle = { backgroundColor: 'var(--bg-card, white)' };

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
        <div className={cardClasses} style={cardStyle}>
            {/* Single header row: metadata left, actions right */}
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-100">
                {/* Metadata */}
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline flex-1 min-w-0">
                    {result.metadata?.Name && <span style={{ color: '#111827', fontWeight: 600, fontSize: '0.8rem' }}>{result.metadata.Name}</span>}
                    {result.metadata?.sub_section && (
                        <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>({result.metadata.sub_section.name})</span>
                    )}
                    {result.metadata?.title && resultType === 'granth' && <span style={{ color: '#111827', fontWeight: 600, fontSize: '0.8rem' }}>{result.metadata.title}</span>}
                    {resultType === 'granth' && result.metadata?.adhikar && (
                        <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>Adhikar: {result.metadata.adhikar}</span>
                    )}
                    {resultType === 'granth' && result.metadata?.verse_type && result.metadata?.verse_type_start_num !== undefined && result.metadata?.verse_type_end_num !== undefined && (
                        <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                            {result.metadata.verse_type}: {result.metadata.verse_type_start_num === result.metadata.verse_type_end_num
                                ? result.metadata.verse_type_start_num
                                : `${result.metadata.verse_type_start_num}-${result.metadata.verse_type_end_num}`}
                        </span>
                    )}
                    {resultType === 'granth' && result.metadata?.Author && (
                        <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· {result.metadata.Author}</span>
                    )}
                    {result.metadata?.Series && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· {result.metadata.Series}</span>}
                    {resultType === 'granth' ? (
                        <>
                            {result.chunk_labels?.gatha && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Gatha: {result.chunk_labels.gatha}</span>}
                            {result.chunk_labels?.kalash && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Kalash: {result.chunk_labels.kalash}</span>}
                            {result.chunk_labels?.shlok && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Shlok: {result.chunk_labels.shlok}</span>}
                            {result.chunk_labels?.doha && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Doha: {result.chunk_labels.doha}</span>}
                            {result.chunk_labels?.sutra && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Sutra: {result.chunk_labels.sutra}</span>}
                        </>
                    ) : (
                        <>
                            {result.metadata?.volume && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Vol. {result.metadata.volume}</span>}
                            {result.chunk_labels?.date && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· {result.chunk_labels.date}</span>}
                            {result.chunk_labels?.pravachan_number && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Pravachan No. {result.chunk_labels.pravachan_number}</span>}
                            {result.chunk_labels?.gatha && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Gatha: {result.chunk_labels.gatha}</span>}
                            {result.chunk_labels?.kalash && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Kalash: {result.chunk_labels.kalash}</span>}
                            {result.chunk_labels?.shlok && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Shlok: {result.chunk_labels.shlok}</span>}
                            {result.chunk_labels?.doha && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Doha: {result.chunk_labels.doha}</span>}
                            {result.chunk_labels?.sutra && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Sutra: {result.chunk_labels.sutra}</span>}
                            {!result.metadata?.volume && !result.chunk_labels?.date && !result.chunk_labels?.pravachan_number && !result.chunk_labels?.gatha && !result.chunk_labels?.kalash && !result.chunk_labels?.shlok && !result.chunk_labels?.doha && !result.chunk_labels?.sutra && (
                                <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· {result.filename}</span>
                            )}
                            <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>· Page No. {result.page_number}</span>
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
                            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
                        >
                            <PdfIcon />PDF
                        </a>
                    )}
                    <button onClick={() => setShowShareModal(true)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors">
                        <ShareIcon />Share
                    </button>
                    <button onClick={handleExpandClick} className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 px-1.5 py-0.5 rounded hover:bg-violet-50 transition-colors">
                        <ExpandIcon />Expand
                    </button>
                    {resultType !== 'granth' && (
                        <button onClick={() => onFindSimilar(result)} className="inline-flex items-center gap-1 text-xs text-slate-900 hover:text-sky-700 px-1.5 py-0.5 rounded hover:bg-sky-50 transition-colors">
                            <SimilarIcon />Similar
                        </button>
                    )}
                </div>
            </div>
            <div className={`text-base text-slate-900 ${compact ? 'leading-snug' : 'leading-relaxed'} font-sans`}>
                <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={getHighlightedHTML()} />
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

export const Pagination = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    // This function builds the smart page list (e.g., [1, 2, '...', 22, 23, 24, '...', 49, 50])
    const getPaginationRange = () => {
        // If there are 7 or fewer pages, show all of them without any ellipses.
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }

        // Use a Set to automatically handle duplicate page numbers
        const pages = new Set();

        // Always show the first 2 pages
        pages.add(1);
        pages.add(2);

        // Add pages around the current page
        if (currentPage > 1) pages.add(currentPage - 1);
        pages.add(currentPage);
        if (currentPage < totalPages) pages.add(currentPage + 1);

        // Always show the last 2 pages
        pages.add(totalPages - 1);
        pages.add(totalPages);

        // Convert set to a sorted array and insert ellipses where there are gaps
        const result = [];
        let lastPage = 0;
        const sortedPages = Array.from(pages).sort((a, b) => a - b);

        for (const page of sortedPages) {
            if (page > lastPage + 1) {
                result.push('...');
            }
            result.push(page);
            lastPage = page;
        }

        return result;
    };

    const pageRange = getPaginationRange();

    return (
        <nav className="flex justify-center items-center gap-1 mt-4">
            {/* Previous Page Button */}
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 text-sm bg-white border border-slate-300 rounded hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                &laquo;
            </button>

            {/* Page Number Buttons and Ellipses */}
            {pageRange.map((page, index) => {
                if (typeof page === 'string') {
                    // Render an ellipsis
                    return <span key={`ellipsis-${index}`} className="px-2.5 py-1 text-sm text-slate-500 flex items-center">...</span>;
                }
                // Render a page number button
                return (
                    <button
                        key={page}
                        onClick={() => onPageChange(page)}
                        className={`px-2.5 py-1 text-sm rounded border ${currentPage === page
                            ? 'bg-sky-600 text-white border-sky-600 font-bold'
                            : 'bg-white border-slate-300 hover:bg-neutral-50'
                            }`}
                    >
                        {page}
                    </button>
                );
            })}

            {/* Next Page Button */}
            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-2 py-1 text-sm bg-white border border-slate-300 rounded hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                &raquo;
            </button>
        </nav>
    );
};

export const Tabs = ({ activeTab, setActiveTab, searchData, similarDocumentsData, onClearSimilar }) => {
    const pravachanCount = searchData?.pravachan_results?.total_hits || 0;
    const granthCount = searchData?.granth_results?.total_hits || 0;
    const booksCount = searchData?.books_results?.total_hits || 0;
    const similarCount = similarDocumentsData?.total_results || 0;
    const hasSuggestions = searchData?.suggestions && searchData.suggestions.length > 0;
    // Don't render tabs if there are no results and no similar documents
    const hasAnyResults = (!hasSuggestions && (pravachanCount > 0 || granthCount > 0 || booksCount > 0)) || similarDocumentsData;
    if (!hasAnyResults) return null;

    return (
        <div style={{ backgroundColor: 'var(--bg-card, white)' }} className="flex items-center border-b border-slate-200 bg-white px-3 rounded-t">
            {!hasSuggestions && pravachanCount > 0 && (
                <button
                    onClick={() => setActiveTab('pravachan')}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'pravachan'
                        ? 'border-sky-500 text-sky-700'
                        : 'border-transparent text-slate-900 hover:text-slate-900'
                        }`}
                >
                    🎙️ Pravachan
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'pravachan' ? 'bg-sky-100 text-sky-600' : 'bg-neutral-200 text-slate-900'}`}>{pravachanCount}</span>
                </button>
            )}
            {!hasSuggestions && granthCount > 0 && (
                <button
                    onClick={() => setActiveTab('granth')}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'granth'
                        ? 'border-amber-500 text-amber-700'
                        : 'border-transparent text-slate-900 hover:text-slate-900'
                        }`}
                >
                    📜 Granth
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'granth' ? 'bg-amber-100 text-amber-600' : 'bg-neutral-200 text-slate-900'}`}>{granthCount}</span>
                </button>
            )}
            {!hasSuggestions && booksCount > 0 && (
                <button
                    onClick={() => setActiveTab('books')}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'books'
                        ? 'border-orange-500 text-orange-700'
                        : 'border-transparent text-slate-900 hover:text-slate-900'
                        }`}
                >
                    📚 Books
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'books' ? 'bg-orange-100 text-orange-600' : 'bg-neutral-200 text-slate-900'}`}>{booksCount}</span>
                </button>
            )}
            {similarDocumentsData && (
                <button
                    onClick={() => setActiveTab('similar')}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'similar'
                        ? 'border-slate-500 text-slate-900'
                        : 'border-transparent text-slate-900 hover:text-slate-900'
                        }`}
                >
                    More Like This
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'similar' ? 'bg-neutral-200 text-slate-800' : 'bg-neutral-200 text-slate-900'}`}>{similarCount}</span>
                    <span
                        onClick={(e) => { e.stopPropagation(); onClearSimilar(); }}
                        className="text-red-400 hover:text-red-600 font-bold text-base ml-1 leading-none"
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
            <div className="bg-white border border-slate-200 p-4 rounded mb-4">
                <div className="text-base text-slate-900 text-center">
                    <p>No results found for "<span className="font-bold text-slate-900">{originalQuery}</span>".</p>
                    <p className="text-sm text-slate-500 mt-2">Try different keywords or adjust your filters.</p>
                </div>
            </div>
        );
    }

    // If there are suggestions, show them
    return (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-4">
            <div className="text-base text-yellow-800">
                <p className="mb-3">
                    No results found for "<span className="font-bold text-red-700">{originalQuery}</span>".
                </p>
                <p>
                    Did you mean:
                    <span className="inline-flex flex-wrap items-center gap-2 ml-2">
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={index}
                                onClick={() => onSuggestionClick(suggestion)}
                                className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 font-bold cursor-pointer
                                         underline decoration-2 underline-offset-2
                                         px-2 py-1 rounded transition-colors duration-200
                                         border border-transparent hover:border-blue-300"
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

    const getHighlightedHTML = () => {
        const content = sourceDoc.content_snippet || '';
        return { __html: content.replace(/<em>/g, '<mark class="bg-sky-100 text-sky-900 px-1 rounded">').replace(/<\/em>/g, '</mark>') };
    };

    return (
        <div className="bg-sky-50 border border-sky-200 p-3 rounded-lg mb-3 text-sky-800">
            <h3 className="font-semibold text-sm mb-1.5">Showing results similar to:</h3>
            <div className="text-sm mb-2">
                <span className="font-medium">{sourceDoc.original_filename}</span>
                <span className="ml-3">Page: {sourceDoc.page_number}</span>
            </div>
            <blockquote className="border-l-4 border-sky-300 pl-2 text-base italic text-slate-800 font-sans">
                <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={getHighlightedHTML()} />
            </blockquote>
        </div>
    );
};

export const ResultsList = ({ results, totalResults, pageSize, currentPage, onPageChange, resultType, onFindSimilar, onExpand, onExpandGranth, searchType, query, currentFilters, language, compact }) => {
    const totalPages = Math.ceil(totalResults / pageSize);

    return (
        <div style={{ backgroundColor: 'var(--bg-card, white)' }} className="bg-white p-3 md:p-4">
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
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
    );
};

export const GranthResultsList = ({ results, totalResults, pageSize, currentPage, onPageChange }) => {
    const totalPages = Math.ceil(totalResults / pageSize);

    return (
        <div className="bg-white p-3 md:p-4 rounded-b-md">
            <div className="text-sm text-slate-500 mb-3">Showing {results.length} of {totalResults} granth results.</div>
            <div className="space-y-3">
                {results.map((result, index) => (
                    <GranthResultCard
                        key={`granth-${result.granth_id || index}`}
                        result={result}
                        isFirst={currentPage === 1 && index === 0}
                    />
                ))}
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
    );
};

const SkeletonCard = ({ wide }) => (
    <div style={{ backgroundColor: 'var(--bg-card, white)' }} className="bg-white p-3 rounded border border-slate-200 animate-pulse">
        <div className="flex gap-3 mb-2 pb-2 border-b border-slate-100 items-center">
            <div className="h-2.5 bg-neutral-200 rounded w-24"></div>
            <div className="h-2.5 bg-neutral-200 rounded w-16"></div>
            <div className="h-2.5 bg-neutral-200 rounded w-20"></div>
            <div className="ml-auto flex gap-2">
                <div className="h-2.5 bg-neutral-200 rounded w-10"></div>
                <div className="h-2.5 bg-neutral-200 rounded w-14"></div>
            </div>
        </div>
        <div className="space-y-2">
            <div className="h-3 bg-neutral-200 rounded w-full"></div>
            <div className="h-3 bg-neutral-200 rounded w-full"></div>
            <div className="h-3 bg-neutral-200 rounded" style={{ width: wide ? '70%' : '85%' }}></div>
        </div>
    </div>
);

export const SkeletonResultsList = () => (
    <div className="mt-4 space-y-2.5">
        {[false, true, false, true, false].map((wide, i) => <SkeletonCard key={i} wide={wide} />)}
    </div>
);
