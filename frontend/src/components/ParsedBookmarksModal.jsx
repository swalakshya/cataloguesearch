import React from 'react';
import { Modal } from './ui';

/**
 * ParsedBookmarksModal - Modal for displaying parsed bookmarks split into extracted and ignored sections
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {Function} onClose - Function to call when modal is closed
 * @param {Array} extractedBookmarks - Bookmarks with pravachan_no or date or both
 * @param {Array} ignoredBookmarks - Bookmarks with neither pravachan_no nor date
 * @param {string} title - Modal title (optional)
 */
const ParsedBookmarksModal = ({
    isOpen,
    onClose,
    extractedBookmarks = [],
    ignoredBookmarks = [],
    title = "Parsed Bookmarks"
}) => {
    const ExtractedTableRow = ({ bookmark }) => {
        const indent = bookmark.level * 8;

        return (
            <tr className="border-b border-green-200 hover:bg-green-50">
                <td className="py-2 px-3 text-sm text-slate-700 text-center">{bookmark.page}</td>
                <td className="py-2 px-3 text-sm text-slate-700" style={{ paddingLeft: `${12 + indent}px` }}>
                    {bookmark.title}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.pravachan_no || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.date || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.gatha || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.kalash || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.shlok || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.sutra || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.doha || '-'}
                </td>
                <td className="py-2 px-3 text-sm text-slate-700 text-center">
                    {bookmark.kavya || '-'}
                </td>
            </tr>
        );
    };

    const IgnoredTableRow = ({ bookmark }) => {
        const indent = bookmark.level * 8;

        return (
            <tr className="border-b border-amber-200 hover:bg-amber-50">
                <td className="py-2 px-3 text-sm text-slate-700 text-center">{bookmark.page}</td>
                <td className="py-2 px-3 text-sm text-slate-700" style={{ paddingLeft: `${12 + indent}px` }}>
                    {bookmark.title}
                </td>
            </tr>
        );
    };

    const totalBookmarks = extractedBookmarks.length + ignoredBookmarks.length;

    const modalTitle = (
        <span className="flex flex-col items-start">
            <span>{title}</span>
            <span className="text-xs font-normal text-ink-muted mt-0.5">
                Total: {totalBookmarks} bookmarks ({extractedBookmarks.length} extracted, {ignoredBookmarks.length} ignored)
            </span>
        </span>
    );

    return (
        <Modal open={isOpen} onClose={onClose} title={modalTitle} size="lg">
                    {totalBookmarks === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            <svg className="mx-auto h-12 w-12 text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-base">No bookmarks found</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Extracted Bookmarks Section */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-base font-semibold text-green-800 flex items-center">
                                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Extracted Bookmarks
                                    </h4>
                                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-medium">
                                        {extractedBookmarks.length}
                                    </span>
                                </div>

                                {extractedBookmarks.length > 0 ? (
                                    <div className="bg-green-50 border border-green-200 rounded-lg overflow-hidden">
                                        <table className="w-full">
                                            <thead className="bg-green-100 border-b border-green-300">
                                                <tr>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Page
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider">
                                                        Title
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Pravachan No
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Date
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Gatha
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Kalash
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Shlok
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Sutra
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Doha
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-green-900 uppercase tracking-wider text-center">
                                                        Kavya
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {extractedBookmarks.map((bookmark, index) => (
                                                    <ExtractedTableRow key={index} bookmark={bookmark} />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center text-sm text-green-700">
                                        No extracted bookmarks
                                    </div>
                                )}
                            </div>

                            {/* Ignored Bookmarks Section */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-base font-semibold text-amber-800 flex items-center">
                                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                        </svg>
                                        Ignored Bookmarks
                                    </h4>
                                    <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-medium">
                                        {ignoredBookmarks.length}
                                    </span>
                                </div>

                                {ignoredBookmarks.length > 0 ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
                                        <table className="w-full">
                                            <thead className="bg-amber-100 border-b border-amber-300">
                                                <tr>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-amber-900 uppercase tracking-wider text-center">
                                                        Page
                                                    </th>
                                                    <th className="py-2 px-3 text-left text-xs font-semibold text-amber-900 uppercase tracking-wider">
                                                        Title
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ignoredBookmarks.map((bookmark, index) => (
                                                    <IgnoredTableRow key={index} bookmark={bookmark} />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center text-sm text-amber-700">
                                        No ignored bookmarks
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
        </Modal>
    );
};

export default ParsedBookmarksModal;
