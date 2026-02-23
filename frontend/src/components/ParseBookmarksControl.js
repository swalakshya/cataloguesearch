import React, { useState } from 'react';
import { Spinner } from './SharedComponents';
import ParsedBookmarksModal from './ParsedBookmarksModal';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

/**
 * Recursively flatten a PDF.js outline into a flat bookmark list with resolved page numbers.
 */
const extractBookmarksFromOutline = async (outline, pdfDoc, level = 1) => {
    const bookmarks = [];
    for (const item of outline) {
        let pageNumber = 0;
        try {
            let dest = item.dest;
            if (typeof dest === 'string') {
                dest = await pdfDoc.getDestination(dest);
            }
            if (dest && dest.length > 0) {
                pageNumber = await pdfDoc.getPageIndex(dest[0]) + 1;
            }
        } catch (e) {
            // ignore destination resolution errors
        }
        bookmarks.push({ level, title: item.title || '', page: pageNumber });
        if (item.items && item.items.length > 0) {
            const children = await extractBookmarksFromOutline(item.items, pdfDoc, level + 1);
            bookmarks.push(...children);
        }
    }
    return bookmarks;
};

const ParseBookmarksControl = ({ isPDF, pdfDoc }) => {
    const [parsedBookmarks, setParsedBookmarks] = useState({ extracted: [], ignored: [] });
    const [showParsedBookmarkModal, setShowParsedBookmarkModal] = useState(false);
    const [isParsedBookmarksLoading, setIsParsedBookmarksLoading] = useState(false);
    const [bookmarkLLM, setBookmarkLLM] = useState('ollama');
    const [error, setError] = useState(null);

    const handleFetchParsedBookmarks = async () => {
        if (!pdfDoc) {
            setError('No PDF loaded.');
            return;
        }

        setIsParsedBookmarksLoading(true);
        setError(null);

        try {
            // Extract bookmarks client-side using PDF.js
            const outline = await pdfDoc.getOutline();
            if (!outline || outline.length === 0) {
                setError('No bookmarks found in this PDF.');
                setIsParsedBookmarksLoading(false);
                return;
            }

            const bookmarks = await extractBookmarksFromOutline(outline, pdfDoc);

            // Send bookmark JSON to backend for LLM parsing
            const response = await fetch(`${API_BASE_URL}/eval/bookmarks/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmarks, llm_provider: bookmarkLLM }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || `HTTP error! status: ${response.status}`);
            }

            const extracted = [];
            const ignored = [];

            data.bookmarks.forEach(bookmark => {
                if (bookmark.pravachan_no || bookmark.date || bookmark.gatha || bookmark.kalash || bookmark.shlok) {
                    extracted.push(bookmark);
                } else {
                    ignored.push(bookmark);
                }
            });

            setParsedBookmarks({ extracted, ignored });
            setShowParsedBookmarkModal(true);

        } catch (err) {
            setError(`Failed to parse bookmarks: ${err.message}`);
            console.error('Parsed Bookmarks Error:', err);
        } finally {
            setIsParsedBookmarksLoading(false);
        }
    };

    if (!isPDF || !pdfDoc) {
        return null;
    }

    return (
        <>
            <ParsedBookmarksModal
                isOpen={showParsedBookmarkModal}
                onClose={() => setShowParsedBookmarkModal(false)}
                extractedBookmarks={parsedBookmarks.extracted}
                ignoredBookmarks={parsedBookmarks.ignored}
            />
            <div className="flex items-center space-x-2">
                {error && <span className="text-xs text-red-600">{error}</span>}
                <select
                    value={bookmarkLLM}
                    onChange={(e) => setBookmarkLLM(e.target.value)}
                    className="text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    disabled={isParsedBookmarksLoading}
                >
                    <option value="ollama">Ollama (Local)</option>
                    <option value="groq">Groq</option>
                    <option value="gemini">Gemini</option>
                </select>
                <button
                    onClick={handleFetchParsedBookmarks}
                    disabled={isParsedBookmarksLoading}
                    className="text-sm text-purple-600 hover:text-purple-800 flex items-center disabled:text-gray-400 disabled:hover:text-gray-400"
                >
                    {isParsedBookmarksLoading ? (
                        <>
                            <Spinner />
                            <span className="ml-1">Loading...</span>
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                            Parse Bookmarks
                        </>
                    )}
                </button>
            </div>
        </>
    );
};

export default ParseBookmarksControl;