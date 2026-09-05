import React, { useState } from 'react';
import { Modal } from './ui';

/**
 * BookmarkItem - Renders individual bookmark items with nested structure
 */
const BookmarkItem = ({ item, level = 0, onBookmarkClick }) => {
    const [isExpanded, setIsExpanded] = useState(level < 2);

    const hasChildren = item.items && item.items.length > 0;
    const indent = level * 16;

    const handleClick = () => {
        if (item.dest && onBookmarkClick) {
            onBookmarkClick(item);
        }
    };

    return (
        <div className="select-none">
            <div
                className="flex items-center py-1 px-2 hover:bg-slate-100 rounded cursor-pointer text-sm"
                style={{ paddingLeft: `${8 + indent}px` }}
                onClick={handleClick}
            >
                {hasChildren && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        className="mr-1 p-0.5 hover:bg-slate-200 rounded text-slate-600"
                    >
                        <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                )}
                {!hasChildren && <div className="w-4 mr-1" />}

                <div className="flex items-center flex-1">
                    <svg className="w-4 h-4 mr-2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-slate-700 truncate" title={item.title}>
                        {item.title}
                    </span>
                    {item.pageNumber && (
                        <span className="ml-auto text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium whitespace-nowrap">
                            Page {item.pageNumber}
                        </span>
                    )}
                </div>
            </div>

            {hasChildren && isExpanded && (
                <div>
                    {item.items.map((child, index) => (
                        <BookmarkItem
                            key={index}
                            item={child}
                            level={level + 1}
                            onBookmarkClick={onBookmarkClick}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * BookmarksModal - Reusable modal component for displaying PDF bookmarks
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {Function} onClose - Function to call when modal is closed
 * @param {Array} bookmarks - Array of bookmark objects
 * @param {Function} onBookmarkClick - Function to call when a bookmark is clicked
 * @param {string} title - Modal title (optional)
 */
const BookmarksModal = ({
    isOpen,
    onClose,
    bookmarks = [],
    onBookmarkClick,
    title = "Select Bookmark"
}) => {
    const effectivelyOpen = isOpen && bookmarks.length > 0;

    const handleBookmarkClickInternal = (bookmark) => {
        if (onBookmarkClick) {
            onBookmarkClick(bookmark);
        }
        onClose(); // Auto-close modal after selection
    };

    return (
        <Modal open={effectivelyOpen} onClose={onClose} title={title} size="md">
            {bookmarks.length > 0 ? (
                <div className="space-y-1">
                    {bookmarks.map((bookmark, index) => (
                        <BookmarkItem
                            key={index}
                            item={bookmark}
                            level={0}
                            onBookmarkClick={handleBookmarkClickInternal}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-center py-8 text-slate-500">
                    <svg className="mx-auto h-12 w-12 text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p>No bookmarks available</p>
                </div>
            )}
        </Modal>
    );
};

export default BookmarksModal;
