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
                    {granth.original_filename && <span className="text-slate-600">{granth.original_filename}</span>}
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
                                <span className="font-bold text-slate-700">Adhikar: {verse.adhikar}</span>
                            )}
                            {verse.type && verse.type_start_num !== undefined && verse.type_end_num !== undefined && (
                                <span className="text-slate-700">
                                    Verse Type ({verse.type}): {verse.type_start_num === verse.type_end_num
                                        ? verse.type_start_num
                                        : `${verse.type_start_num}-${verse.type_end_num}`}
                                </span>
                            )}
                            {verse.page_num && (
                                <span className="text-slate-700">Page Number: {verse.page_num}</span>
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
                                <p className="text-base font-semibold text-slate-700 leading-relaxed whitespace-pre-wrap">{verse.verse}</p>
                            </div>
                        )}

                        {verse.translation && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-slate-600 mb-1">Translation:</p>
                                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{verse.translation}</p>
                            </div>
                        )}

                        {verse.meaning && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-slate-600 mb-1">Meaning:</p>
                                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{verse.meaning}</p>
                            </div>
                        )}

                        {verse.teeka && (
                            <div className="mb-2">
                                <p className="text-sm font-medium text-slate-600 mb-1">Teeka:</p>
                                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{verse.teeka}</p>
                            </div>
                        )}

                        {verse.bhavarth && (
                            <div>
                                <p className="text-sm font-medium text-slate-600 mb-1">Bhavarth:</p>
                                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{verse.bhavarth}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export const ResultCard = ({ result, onFindSimilar, onExpand, onExpandGranth, resultType, isFirst, query, currentFilters, language, searchType }) => {
    const [showShareModal, setShowShareModal] = useState(false);
    const getHighlightedHTML = () => {
        const content = result.content_snippet || '';
        // CORRECTED: The highlight class is now consistently `bg-sky-200` for all results to ensure visibility.
        return { __html: content.replace(/<em>/g, `<mark class="bg-sky-200 text-slate-800 px-1 rounded">`).replace(/<\/em>/g, '</mark>') };
    };

    const cardClasses = isFirst
        ? "bg-white p-4 rounded-lg border-2 border-sky-500 shadow-md"
        : "bg-white p-3 rounded-md border border-slate-200 transition-shadow hover:shadow-sm";

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
            {/* Row 1: metadata */}
            <div className="flex flex-wrap gap-x-2 gap-y-1 items-baseline mb-1 text-sm">
                {result.metadata?.Granth && <span className="font-semibold text-slate-800">{result.metadata.Granth}</span>}
                {result.metadata?.sub_section && (
                    <span className="text-slate-500 text-xs">({result.metadata.sub_section.name})</span>
                )}
                {result.metadata?.title && resultType === 'granth' && <span className="font-semibold text-slate-800">{result.metadata.title}</span>}
                {resultType === 'granth' && result.metadata?.adhikar && (
                    <span className="text-slate-500 text-xs">Adhikar: {result.metadata.adhikar}</span>
                )}
                {resultType === 'granth' && result.metadata?.verse_type && result.metadata?.verse_type_start_num !== undefined && result.metadata?.verse_type_end_num !== undefined && (
                    <span className="text-slate-500 text-xs">
                        {result.metadata.verse_type}: {result.metadata.verse_type_start_num === result.metadata.verse_type_end_num
                            ? result.metadata.verse_type_start_num
                            : `${result.metadata.verse_type_start_num}-${result.metadata.verse_type_end_num}`}
                    </span>
                )}
                {resultType === 'granth' && result.metadata?.Author && (
                    <span className="text-slate-500 text-xs">· {result.metadata.Author}</span>
                )}
                {result.metadata?.Series && <span className="text-slate-500 text-xs">· {result.metadata.Series}</span>}
                {result.date && result.pravachan_number ? (
                    <>
                        <span className="text-slate-400 text-xs">· {result.date}</span>
                        <span className="text-slate-400 text-xs">· #{result.pravachan_number}</span>
                    </>
                ) : (
                    <>
                        {resultType !== 'granth' && <span className="text-slate-400 text-xs">· {result.filename}</span>}
                        {resultType === 'granth' ? (
                            <>
                                {result.gatha && <span className="text-slate-400 text-xs">· Gatha: {result.gatha}</span>}
                                {result.kalash && <span className="text-slate-400 text-xs">· Kalash: {result.kalash}</span>}
                                {result.shlok && <span className="text-slate-400 text-xs">· Shlok: {result.shlok}</span>}
                            </>
                        ) : (
                            <span className="text-slate-400 text-xs">· p.{result.page_number}</span>
                        )}
                    </>
                )}
            </div>
            {/* Row 2: actions */}
            <div className="flex items-center gap-1 mb-2 pb-2 border-b border-slate-100">
                {result.file_url && (
                    <a
                        href={`${result.file_url}#page=${result.pdf_page_number ?? result.page_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors"
                    >
                        <PdfIcon />PDF
                    </a>
                )}
                <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => setShowShareModal(true)} title="Share" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-sky-600 px-2 py-1 rounded-md hover:bg-sky-50 transition-colors">
                        <ShareIcon />Share
                    </button>
                    <button onClick={handleExpandClick} title="Expand context" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-sky-600 px-2 py-1 rounded-md hover:bg-sky-50 transition-colors">
                        <ExpandIcon />Expand
                    </button>
                    {resultType !== 'granth' && (
                        <button onClick={() => onFindSimilar(result)} title="Find similar" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-sky-600 px-2 py-1 rounded-md hover:bg-sky-50 transition-colors">
                            <SimilarIcon />More Like This
                        </button>
                    )}
                </div>
            </div>
            <div className={`${isFirst ? 'text-lg' : 'text-base'} text-slate-700 leading-relaxed font-sans`}>
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
                className="px-2 py-1 text-sm bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        className={`px-2.5 py-1 text-sm rounded-md border ${
                            currentPage === page 
                                ? 'bg-sky-600 text-white border-sky-600 font-bold' 
                                : 'bg-white border-slate-300 hover:bg-slate-50'
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
                className="px-2 py-1 text-sm bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                &raquo;
            </button>
        </nav>
    );
};

export const Tabs = ({ activeTab, setActiveTab, searchData, similarDocumentsData, onClearSimilar }) => {
    const pravachanCount = searchData?.pravachan_results?.total_hits || 0;
    const granthCount = searchData?.granth_results?.total_hits || 0;
    const similarCount = similarDocumentsData?.total_results || 0;
    const hasSuggestions = searchData?.suggestions && searchData.suggestions.length > 0;
    // Don't render tabs if there are no results and no similar documents
    const hasAnyResults = (!hasSuggestions && (pravachanCount > 0 || granthCount > 0)) || similarDocumentsData;
    if (!hasAnyResults) return null;

    return (
        <div className="flex items-center gap-1 mb-3 p-1 bg-slate-100 rounded-md w-fit">
            {!hasSuggestions && pravachanCount > 0 && (
                <button
                    onClick={() => setActiveTab('pravachan')}
                    className={`flex items-center gap-2 px-3 py-1 text-sm font-medium rounded transition-all duration-200 ${
                        activeTab === 'pravachan'
                            ? 'bg-white text-sky-700 shadow-sm font-semibold'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    🎙️ Pravachan
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-normal ${activeTab === 'pravachan' ? 'bg-sky-100 text-sky-600' : 'bg-slate-200 text-slate-500'}`}>{pravachanCount}</span>
                </button>
            )}
            {!hasSuggestions && granthCount > 0 && (
                <button
                    onClick={() => setActiveTab('granth')}
                    className={`flex items-center gap-2 px-3 py-1 text-sm font-medium rounded transition-all duration-200 ${
                        activeTab === 'granth'
                            ? 'bg-white text-amber-700 shadow-sm font-semibold'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    📜 Granth
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-normal ${activeTab === 'granth' ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-500'}`}>{granthCount}</span>
                </button>
            )}
            {similarDocumentsData && (
                <button
                    onClick={() => setActiveTab('similar')}
                    className={`flex items-center gap-2 px-3 py-1 text-sm font-medium rounded transition-all duration-200 ${
                        activeTab === 'similar'
                            ? 'bg-white text-slate-700 shadow-sm font-semibold'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    More Like This
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-normal ${activeTab === 'similar' ? 'bg-slate-200 text-slate-600' : 'bg-slate-200 text-slate-500'}`}>{similarCount}</span>
                    <span
                        onClick={(e) => { e.stopPropagation(); onClearSimilar(); }}
                        className="text-red-400 hover:text-red-600 font-bold text-base ml-0.5 leading-none"
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
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg mb-4">
                <div className="text-base text-slate-700 text-center">
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
            <blockquote className="border-l-4 border-sky-300 pl-2 text-base italic text-slate-600 font-sans">
                <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={getHighlightedHTML()} />
            </blockquote>
        </div>
    );
};

export const ResultsList = ({ results, totalResults, pageSize, currentPage, onPageChange, resultType, onFindSimilar, onExpand, onExpandGranth, searchType, query, currentFilters, language }) => {
    const totalPages = Math.ceil(totalResults / pageSize);

    return (
        <div className="bg-white p-3 md:p-4 rounded-b-md">
            <div className="text-sm text-slate-500 mb-3">Showing {results.length} of {totalResults} results.</div>
            <div className="space-y-3">
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
