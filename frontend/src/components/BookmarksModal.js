import React, { useState } from 'react';
import { useOverlayBehavior } from './ui/Modal';

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
    useOverlayBehavior(effectivelyOpen, onClose);

    // Don't render if modal is closed or no bookmarks
    if (!effectivelyOpen) {
        return null;
    }

    const handleBookmarkClickInternal = (bookmark) => {
        if (onBookmarkClick) {
            onBookmarkClick(bookmark);
        }
        onClose(); // Auto-close modal after selection
    };

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 p-1 rounded"
                        title="Close bookmarks"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                {/* Content */}
                <div className="p-4 overflow-y-auto max-h-[calc(80vh-65px)]">
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
                </div>
            </div>
        </div>
    );
};

export default BookmarksModal;