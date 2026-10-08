import React from 'react';

/**
 * Shared ShowBookmarksButton component
 * Used consistently across OCRUtils and ParagraphGenEval components
 * 
 * @param {boolean} hasBookmarks - Whether bookmarks are available
 * @param {Function} onClick - Function to call when button is clicked
 * @param {boolean} disabled - Whether the button is disabled (optional)
 */
const ShowBookmarksButton = ({ 
    hasBookmarks, 
    onClick, 
    disabled = false 
}) => {
    // Only show button if bookmarks are available
    if (!hasBookmarks) {
        return null;
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="text-sm text-sky-600 hover:text-sky-800 flex items-center disabled:text-gray-400 disabled:hover:text-gray-400"
        >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Show Bookmarks
        </button>
    );
};

export default ShowBookmarksButton;