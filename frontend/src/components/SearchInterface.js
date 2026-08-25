import React, { useState, useEffect, useMemo } from 'react';
import TransliterationInput from './TransliterationInput';

// --- UTILITY FUNCTIONS ---
const parseYear = (dateString) => {
    // Handle both "DD-MM-YYYY" and "YYYY-MM-DD" formats
    if (!dateString) return null;
    const match = dateString.match(/\d{4}/);
    return match ? parseInt(match[0]) : null;
};

const extractYearsFromMetadata = (metadata, selectedGranths, language) => {
    const dateRanges = metadata?.Pravachan?.[language]?.['Granth_date_ranges'];

    if (!dateRanges) return [];

    let relevantRanges = [];

    if (selectedGranths.length === 0) {
        // No Granth selected → show all years
        relevantRanges = Object.values(dateRanges).flat();
    } else {
        // Specific Granths → show only their years
        relevantRanges = selectedGranths
            .map(granth => dateRanges[granth] || [])
            .flat();
    }

    // Extract years and deduplicate
    const years = new Set();
    relevantRanges.forEach(range => {
        const startYear = parseYear(range.start_date);
        const endYear = parseYear(range.end_date);
        if (startYear && endYear) {
            // Add all years in the range
            for (let y = startYear; y <= endYear; y++) {
                years.add(y);
            }
        }
    });

    return Array.from(years).sort((a, b) => a - b);
};

// --- SEARCH INTERFACE COMPONENTS ---
export const SearchBar = ({ query, setQuery, onSearch, language, disabled = false }) => {
    return (
        <TransliterationInput
            value={query}
            onChange={setQuery}
            onSearch={onSearch}
            language={language}
            placeholder="Enter your search query..."
            autoFocus={true}
            disabled={disabled}
        />
    );
};

export const MetadataFilters = ({ metadata, activeFilters, onAddFilter, onRemoveFilter, contentTypes, setContentTypes, language, startYear, setStartYear, endYear, setEndYear, activeCategories = ['Pravachan', 'Granth'] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [granthMode, setGranthMode] = useState('all'); // 'all' or 'specific'
    const [selectedGranths, setSelectedGranths] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const defaultContentTypes = {
        pravachans: activeCategories.includes('Pravachan'),
        granths: activeCategories.includes('Granth'),
        books: activeCategories.includes('Books'),
    };
    const hasNonDefaultContentTypes =
        contentTypes.pravachans !== defaultContentTypes.pravachans ||
        contentTypes.granths !== defaultContentTypes.granths ||
        contentTypes.books !== defaultContentTypes.books;

    // Extract available items (Name values) from metadata structure
    const getAvailableGranths = () => {
        const items = new Set();

        // Get Names from Pravachan metadata if enabled
        if (contentTypes.pravachans && metadata['Pravachan']?.[language]?.['Name']) {
            const list = metadata['Pravachan'][language]['Name'];
            if (Array.isArray(list)) list.forEach(g => items.add(g));
        }

        // Get Names from Granth metadata if enabled
        if (contentTypes.granths && metadata['Granth']?.[language]?.['Name']) {
            const list = metadata['Granth'][language]['Name'];
            if (Array.isArray(list)) list.forEach(g => items.add(g));
        }

        // Get Book Names from Books metadata if enabled
        if (contentTypes.books && metadata['Books']?.[language]?.['Name']) {
            const list = metadata['Books'][language]['Name'];
            if (Array.isArray(list)) list.forEach(n => items.add(n));
        }

        return Array.from(items).sort();
    };

    const availableGranths = getAvailableGranths();

    // Extract available years based on selected Granths
    const availableYears = extractYearsFromMetadata(metadata, selectedGranths, language);
    const endYearOptions = startYear ? availableYears.filter(y => y >= startYear) : availableYears;
    const filteredGranths = availableGranths.filter(granth =>
        granth.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sync selectedGranths with activeFilters on mount and when filters change
    useEffect(() => {
        const itemFilters = activeFilters.filter(f => f.key === 'Name');
        if (itemFilters.length > 0) {
            setGranthMode('specific');
            setSelectedGranths(itemFilters.map(f => f.value));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Handle Escape key to close modal
    useEffect(() => {
        const handleEsc = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    const handleGranthToggle = (granth) => {
        setSelectedGranths(prev => {
            if (prev.includes(granth)) {
                return prev.filter(g => g !== granth);
            } else {
                return [...prev, granth];
            }
        });
    };

    const handleApply = () => {
        // Remove all existing Name filters first
        const filterIndicesToRemove = [];
        activeFilters.forEach((filter, index) => {
            if (filter.key === 'Name') {
                filterIndicesToRemove.push(index);
            }
        });
        filterIndicesToRemove.reverse().forEach(index => onRemoveFilter(index));

        // Add back filters
        if (granthMode === 'specific' && selectedGranths.length > 0) {
            selectedGranths.forEach(item => {
                onAddFilter({ key: 'Name', value: item });
            });
        }

        setIsOpen(false);
    };

    const handleClearAll = () => {
        setGranthMode('all');
        setSelectedGranths([]);
        setContentTypes(defaultContentTypes);
        setSearchTerm('');
        setStartYear(null);
        setEndYear(null);
        // Remove all Name filters
        const filterIndicesToRemove = [];
        activeFilters.forEach((filter, index) => {
            if (filter.key === 'Name') {
                filterIndicesToRemove.push(index);
            }
        });
        filterIndicesToRemove.reverse().forEach(index => onRemoveFilter(index));
    };

    const granthFilterCount = activeFilters.filter(f => f.key === 'Name').length;

    const getContentTypeText = () => {
        const parts = [];
        if (contentTypes.pravachans) parts.push('Pravachans');
        if (contentTypes.granths) parts.push('Granths');
        if (contentTypes.books) parts.push('Books');
        if (parts.length === 0) return 'None selected';
        return parts.join(' + ');
    };

    const getSummaryText = () => {
        const hasContentTypeFilter = hasNonDefaultContentTypes;
        const hasYearFilter = startYear || endYear;
        const totalActiveFilters = granthFilterCount + (hasContentTypeFilter ? 1 : 0) + (hasYearFilter ? 1 : 0);

        if (totalActiveFilters === 0) {
            return 'All Content';
        }

        return `Filters (${totalActiveFilters})`;
    };

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-900 font-semibold uppercase tracking-wide">Refine search</p>

            {/* Filter Button */}
            <button
                onClick={() => setIsOpen(true)}
                style={{ backgroundColor: 'var(--bg-surface, white)' }}
                className="w-full py-1 px-3 bg-white border border-slate-300 rounded text-left text-slate-900 text-sm font-medium hover:bg-neutral-50 transition-colors focus:ring-2 focus:ring-sky-500 flex items-center justify-between"
            >
                <span>{getSummaryText()}</span>
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Active Filters */}
            {(granthFilterCount > 0 || hasNonDefaultContentTypes || startYear || endYear) && (
                <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="font-semibold text-slate-600 text-sm">Active:</span>

                    {/* Content Type Chip (only if not at configured default) */}
                    {hasNonDefaultContentTypes && (
                        <div className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full flex items-center gap-2 text-sm font-medium">
                            <span>{getContentTypeText()}</span>
                            <button
                                onClick={() => setContentTypes(defaultContentTypes)}
                                className="text-purple-600 hover:text-purple-800 font-bold"
                            >
                                &times;
                            </button>
                        </div>
                    )}

                    {/* Granth Filters - Show summary if more than 3, otherwise show individual chips */}
                    {granthFilterCount > 3 ? (
                        <div className="bg-sky-100 text-sky-800 px-2 py-1 rounded-full flex items-center gap-2 text-sm font-medium">
                            <span>{granthFilterCount} items selected</span>
                            <button
                                onClick={() => setIsOpen(true)}
                                className="text-sky-600 hover:text-sky-800 font-bold text-xs"
                                title="Click to view/edit selections"
                            >
                                View
                            </button>
                        </div>
                    ) : (
                        activeFilters.filter(f => f.key === 'Name').map((filter, index) => (
                            <div key={index} className="bg-sky-100 text-sky-800 px-2 py-1 rounded-full flex items-center gap-2 text-sm font-medium">
                                <span>{filter.value}</span>
                                <button
                                    onClick={() => {
                                        const actualIndex = activeFilters.findIndex(f => f.key === 'Name' && f.value === filter.value);
                                        onRemoveFilter(actualIndex);
                                        setSelectedGranths(prev => prev.filter(g => g !== filter.value));
                                        if (activeFilters.filter(f => f.key === 'Name').length === 1) {
                                            setGranthMode('all');
                                        }
                                    }}
                                    className="text-sky-600 hover:text-sky-800 font-bold"
                                >
                                    &times;
                                </button>
                            </div>
                        ))
                    )}

                    {/* Year Filter Chip */}
                    {(startYear || endYear) && (
                        <div className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full flex items-center gap-2 text-sm font-medium">
                            <span>📅 {startYear || '?'} - {endYear || '?'}</span>
                            <button
                                onClick={() => {
                                    setStartYear(null);
                                    setEndYear(null);
                                }}
                                className="text-emerald-600 hover:text-emerald-800 font-bold"
                            >
                                &times;
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Modal/Bottom Sheet */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black bg-opacity-50 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Modal Content */}
                    <div className="fixed inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center z-50">
                        <div className="bg-white rounded-t-lg md:rounded-lg shadow-2xl w-full md:max-w-lg md:max-h-[80vh] flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                            {/* Header */}
                            <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white rounded-t-lg md:rounded-t-lg">
                                <h3 className="text-lg font-bold text-slate-800">Filters</h3>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="text-slate-400 hover:text-slate-600 p-1"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-4 overflow-y-auto flex-1">
                                {/* Content Type Section */}
                                <div className="mb-6">
                                    <h4 className="text-sm font-semibold text-slate-600 mb-3">Content Type</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => setContentTypes(prev => ({ ...prev, pravachans: !prev.pravachans }))}
                                            className={`p-2 rounded border-2 font-medium transition-all text-sm flex items-center justify-center gap-1.5 ${
                                                contentTypes.pravachans
                                                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                                                    : 'border-slate-300 bg-white text-slate-600'
                                            }`}
                                        >
                                            {contentTypes.pravachans && (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                            🎙️ Pravachan on Granths
                                        </button>
                                        <button
                                            onClick={() => setContentTypes(prev => ({ ...prev, granths: !prev.granths }))}
                                            className={`p-2 rounded border-2 font-medium transition-all text-sm flex items-center justify-center gap-1.5 ${
                                                contentTypes.granths
                                                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                                                    : 'border-slate-300 bg-white text-slate-600'
                                            }`}
                                        >
                                            {contentTypes.granths && (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                            📜 Mool Shastra
                                        </button>
                                        {activeCategories.includes('Books') && (
                                            <button
                                                onClick={() => setContentTypes(prev => ({ ...prev, books: !prev.books }))}
                                                className={`p-2 rounded border-2 font-medium transition-all text-sm flex items-center justify-center gap-1.5 ${
                                                    contentTypes.books
                                                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                                                        : 'border-slate-300 bg-white text-slate-600'
                                                }`}
                                            >
                                                {contentTypes.books && (
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                                📚 Books
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 pt-4 mb-4"></div>

                                {/* Granth Filter Section */}
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-600 mb-3">Filter by ...</h4>

                                    {/* Radio Buttons */}
                                    <div className="space-y-2 mb-4">
                                        <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="granthMode"
                                                checked={granthMode === 'all'}
                                                onChange={() => {
                                                    setGranthMode('all');
                                                    setSelectedGranths([]);
                                                }}
                                                className="form-radio h-4 w-4 text-sky-600 focus:ring-sky-500"
                                            />
                                            <span className="text-base font-medium">{contentTypes.books && !contentTypes.pravachans && !contentTypes.granths ? 'All Books' : 'All Granths'}</span>
                                        </label>
                                        <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="granthMode"
                                                checked={granthMode === 'specific'}
                                                onChange={() => setGranthMode('specific')}
                                                className="form-radio h-4 w-4 text-sky-600 focus:ring-sky-500"
                                            />
                                            <span className="text-base font-medium">{contentTypes.books && !contentTypes.pravachans && !contentTypes.granths ? 'Specific Books' : 'Specific Granths'}</span>
                                        </label>
                                    </div>

                                    {/* Granth/Book Selection */}
                                    {granthMode === 'specific' && (
                                        <div className="space-y-3">
                                            <div className="text-sm text-slate-600 mb-2">
                                                {contentTypes.books && !contentTypes.pravachans && !contentTypes.granths ? 'Select specific Books:' : 'Select specific Granths:'}
                                            </div>

                                            {/* Search Box */}
                                            <input
                                                type="text"
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                placeholder={contentTypes.books && !contentTypes.pravachans && !contentTypes.granths ? '🔍 Search Books...' : '🔍 Search Granths...'}
                                                className="w-full p-2 bg-white border border-slate-300 rounded text-slate-800 text-base focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                                            />

                                            {/* Granth List */}
                                            <div className="relative">
                                                <div
                                                    className="max-h-64 overflow-y-auto border border-slate-200 rounded"
                                                    style={{
                                                        scrollbarWidth: 'thin',
                                                        scrollbarColor: '#94a3b8 #f1f5f9'
                                                    }}
                                                >
                                                    <style>{`
                                                        .max-h-64::-webkit-scrollbar {
                                                            width: 8px;
                                                        }
                                                        .max-h-64::-webkit-scrollbar-track {
                                                            background: #f1f5f9;
                                                            border-radius: 4px;
                                                        }
                                                        .max-h-64::-webkit-scrollbar-thumb {
                                                            background: #94a3b8;
                                                            border-radius: 4px;
                                                        }
                                                        .max-h-64::-webkit-scrollbar-thumb:hover {
                                                            background: #64748b;
                                                        }
                                                    `}</style>
                                                    {filteredGranths.length > 0 ? (
                                                        filteredGranths.map((granth, index) => (
                                                            <label
                                                                key={index}
                                                                className="flex items-center gap-3 p-3 hover:bg-neutral-50 cursor-pointer border-b border-neutral-100 last:border-b-0"
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedGranths.includes(granth)}
                                                                    onChange={() => handleGranthToggle(granth)}
                                                                    className="form-checkbox h-5 w-5 text-sky-600 focus:ring-sky-500 rounded"
                                                                />
                                                                <span className="text-slate-700">{granth}</span>
                                                            </label>
                                                        ))
                                                    ) : (
                                                        <div className="p-4 text-center text-slate-600 text-sm">
                                                            No Granths found
                                                        </div>
                                                    )}
                                                </div>
                                                {filteredGranths.length > 5 && (
                                                    <div className="text-center text-xs text-slate-400 mt-1">
                                                        ↓ Scroll for more ↓
                                                    </div>
                                                )}
                                            </div>

                                            {selectedGranths.length > 0 && (
                                                <div className="text-sm text-slate-600">
                                                    {selectedGranths.length} Granth{selectedGranths.length > 1 ? 's' : ''} selected
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="border-t border-slate-200 pt-4 mb-4"></div>

                                {/* Year Range Section */}
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-600 mb-3">Year Range (Optional)</h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        {/* Start Year */}
                                        <div>
                                            <label className="block text-sm text-slate-600 mb-1">Start Year</label>
                                            <select
                                                value={startYear || ''}
                                                onChange={(e) => {
                                                    const year = e.target.value ? parseInt(e.target.value) : null;
                                                    setStartYear(year);
                                                    // Reset end year if it's less than the new start year
                                                    if (endYear && year && endYear < year) {
                                                        setEndYear(null);
                                                    }
                                                }}
                                                className="w-full p-2 bg-white border border-slate-300 rounded text-slate-800 text-base focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                                            >
                                                <option value="">Any</option>
                                                {availableYears.map(year => (
                                                    <option key={year} value={year}>{year}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* End Year */}
                                        <div>
                                            <label className="block text-sm text-slate-600 mb-1">End Year</label>
                                            <select
                                                value={endYear || ''}
                                                onChange={(e) => setEndYear(e.target.value ? parseInt(e.target.value) : null)}
                                                className="w-full p-2 bg-white border border-slate-300 rounded-md text-slate-800 text-base focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={!startYear}
                                            >
                                                <option value="">Any</option>
                                                {endYearOptions.map(year => (
                                                    <option key={year} value={year}>{year}</option>
                                                ))}
                                            </select>
                                            {!startYear && (
                                                <p className="text-xs text-slate-600 mt-1">Select start year first</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-slate-200 flex gap-2 sticky bottom-0 bg-white rounded-b-lg md:rounded-b-lg">
                                <button
                                    onClick={handleClearAll}
                                    className="flex-1 px-4 py-1.5 border border-slate-300 rounded text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                                >
                                    Clear All
                                </button>
                                <button
                                    onClick={handleApply}
                                    className="flex-1 px-4 py-1.5 bg-sky-600 text-white rounded font-semibold hover:bg-sky-700 transition-colors"
                                >
                                    Apply {granthMode === 'specific' && selectedGranths.length > 0 && `(${selectedGranths.length})`}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// ─── helpers ────────────────────────────────────────────────────────────────

// _pravachan_groups carries paired per-series {granth, series, volume, pravachan_number}
// filters (as JSON strings) — see backend/search/index_searcher.py's
// _build_pravachan_group_filter for why a plain flat Series/volume/pravachan_number
// filter can't express independently-narrowed series correctly.
const PRAVACHAN_FILTER_KEYS = ['_pravachan_groups'];

const extractPravachanYears = (cascade) => {
    const years = new Set();
    cascade.forEach(s => {
        const start = s.start_date ? parseInt(s.start_date.substring(0, 4)) : null;
        const end   = s.end_date   ? parseInt(s.end_date.substring(0, 4))   : null;
        if (start && end) for (let y = start; y <= end; y++) years.add(y);
    });
    return Array.from(years).sort((a, b) => a - b);
};

const sortPravachanNumbers = (nums) =>
    [...nums].sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        return (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b));
    });

// Small chip used inside the modal header breadcrumbs
const BreadcrumbChip = ({ label }) => (
    <span className="bg-sky-100 text-sky-700 text-xs font-semibold px-2 py-0.5 rounded-full">{label}</span>
);

// Compact toggleable number/string button used in volume and pravachan# grids
const GridToggle = ({ value, selected, onToggle }) => (
    <button
        onClick={() => onToggle(value)}
        className={`rounded text-sm py-1.5 font-medium transition-colors border ${
            selected
                ? 'bg-sky-600 border-sky-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
        }`}
    >
        {value}
    </button>
);

// ─── PravachanFilter ─────────────────────────────────────────────────────────

const PravachanFilter = ({
    allMetadata, activeFilters, onAddFilter, onRemoveFilter,
    language, startYear, setStartYear, endYear, setEndYear,
}) => {
    const [isOpen, setIsOpen]         = useState(false);
    const [pendingGranths, setPendingGranths] = useState([]);
    const [pendingSeries, setPendingSeries]   = useState([]); // composite keys: seriesKey(granth, name)
    const [pendingVolumesBySeries, setPendingVolumesBySeries] = useState({}); // { [seriesKey]: number[] }
    const [pendingNumbersBySeries, setPendingNumbersBySeries] = useState({}); // { [seriesKey]: string[] }
    const [expandedGranths, setExpandedGranths] = useState([]);
    const [narrowingKey, setNarrowingKey] = useState(null); // seriesKey currently open in the popup, or null
    const [narrowStep, setNarrowStep] = useState('volumes'); // 'volumes' | 'numbers', within the popup

    const cascade = allMetadata?.Pravachan?.hindi?.pravachan_series_cascade || [];

    // Series names are only unique *within* a Granth (e.g. two different Granths can each
    // have a "1979 Series") — every selection must be keyed by Granth+name, never name alone.
    const seriesKey = (granth, name) => `${granth} :: ${name}`;

    // Granths that actually have Pravachan content — the accordion list.
    const granthOptions = useMemo(() => {
        const names = new Set();
        cascade.forEach(s => { if (s.granth) names.add(s.granth); });
        return Array.from(names).sort();
    }, [cascade]);

    const seriesByGranth = useMemo(() => {
        const map = {};
        cascade.forEach(s => {
            if (!s.granth) return;
            (map[s.granth] = map[s.granth] || []).push(s);
        });
        return map;
    }, [cascade]);

    const seriesByKey = useMemo(() => {
        const map = {};
        cascade.forEach(s => { if (s.granth) map[seriesKey(s.granth, s.name)] = s; });
        return map;
    }, [cascade]);

    // Sync pending state from activeFilters when opening
    useEffect(() => {
        if (!isOpen) return;
        const activeNames = activeFilters.filter(f => f.key === 'Name').map(f => f.value);
        const activeGranths = activeNames.filter(n => granthOptions.includes(n));

        const groups = activeFilters
            .filter(f => f.key === '_pravachan_groups')
            .map(f => { try { return JSON.parse(f.value); } catch { return null; } })
            .filter(Boolean);

        const keys = [];
        const volsBySeries = {};
        const numsBySeries = {};
        groups.forEach(g => {
            const key = seriesKey(g.granth, g.series);
            keys.push(key);
            if (g.volume?.length) volsBySeries[key] = g.volume;
            if (g.pravachan_number?.length) numsBySeries[key] = g.pravachan_number;
        });

        setPendingGranths(activeGranths);
        setPendingSeries(keys);
        setPendingVolumesBySeries(volsBySeries);
        setPendingNumbersBySeries(numsBySeries);

        const seriesGranths = new Set(groups.map(g => g.granth));
        setExpandedGranths([...new Set([...activeGranths, ...seriesGranths])]);
        setNarrowingKey(null);
        setNarrowStep('volumes');
    }, [isOpen]); // eslint-disable-line

    // Close on Escape — closes the narrow popup first if it's open, else the whole modal.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (narrowingKey) setNarrowingKey(null);
            else setIsOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, narrowingKey]);

    const toggleExpand = (granth) =>
        setExpandedGranths(prev => prev.includes(granth) ? prev.filter(x => x !== granth) : [...prev, granth]);

    // Checking a Granth means "all its series"; unchecking it clears its selection entirely.
    const toggleGranth = (granth) => {
        setPendingGranths(prev => {
            if (prev.includes(granth)) return prev.filter(x => x !== granth);
            const keysForGranth = new Set((seriesByGranth[granth] || []).map(s => seriesKey(granth, s.name)));
            setPendingSeries(ps => ps.filter(k => !keysForGranth.has(k))); // now redundant/implied
            return [...prev, granth];
        });
    };

    // Checking/unchecking one series under a Granth. If the Granth was fully selected,
    // unchecking one series demotes it to a partial (indeterminate) selection of the rest.
    const toggleSeriesWithinGranth = (granth, name) => {
        const key = seriesKey(granth, name);
        if (pendingGranths.includes(granth)) {
            const others = (seriesByGranth[granth] || [])
                .filter(s => s.name !== name)
                .map(s => seriesKey(granth, s.name));
            setPendingGranths(prev => prev.filter(x => x !== granth));
            setPendingSeries(prev => [...new Set([...prev, ...others])]);
            return;
        }
        setPendingSeries(prev => {
            if (prev.includes(key)) {
                setPendingVolumesBySeries(v => { const n = { ...v }; delete n[key]; return n; });
                setPendingNumbersBySeries(v => { const n = { ...v }; delete n[key]; return n; });
                return prev.filter(x => x !== key);
            }
            return [...prev, key];
        });
    };

    // ── Per-series "narrow" popup (Volumes → Pravachan#) ──────────────────────
    const openNarrow = (granth, name) => { setNarrowingKey(seriesKey(granth, name)); setNarrowStep('volumes'); };
    const closeNarrow = () => setNarrowingKey(null);

    const narrowSeries = narrowingKey ? seriesByKey[narrowingKey] : null;
    const narrowVolumes = narrowingKey ? (pendingVolumesBySeries[narrowingKey] || []) : [];
    const narrowNumbers = narrowingKey ? (pendingNumbersBySeries[narrowingKey] || []) : [];

    const narrowAvailableNumbers = useMemo(() => {
        if (!narrowSeries || !narrowVolumes.length) return [];
        const nums = new Set();
        narrowSeries.volumes
            .filter(v => narrowVolumes.includes(v.volume))
            .forEach(v => v.pravachan_numbers.forEach(n => nums.add(n)));
        return sortPravachanNumbers(Array.from(nums));
    }, [narrowSeries, narrowVolumes]);

    const toggleNarrowVolume = (vol) => {
        setPendingVolumesBySeries(prev => {
            const cur = prev[narrowingKey] || [];
            const next = cur.includes(vol) ? cur.filter(x => x !== vol) : [...cur, vol];
            return { ...prev, [narrowingKey]: next };
        });
        setPendingNumbersBySeries(prev => { const n = { ...prev }; delete n[narrowingKey]; return n; });
    };

    const toggleNarrowNumber = (num) => {
        setPendingNumbersBySeries(prev => {
            const cur = prev[narrowingKey] || [];
            const next = cur.includes(num) ? cur.filter(x => x !== num) : [...cur, num];
            return { ...prev, [narrowingKey]: next };
        });
    };

    const handleApply = () => {
        const toRemove = [];
        activeFilters.forEach((f, i) => {
            if (PRAVACHAN_FILTER_KEYS.includes(f.key)) toRemove.push(i);
            // Only clear Name filters that are actually Pravachan Granths — leaves Granth-tab
            // selections for Books/Granth-category-only titles untouched.
            if (f.key === 'Name' && granthOptions.includes(f.value)) toRemove.push(i);
        });
        toRemove.reverse().forEach(i => onRemoveFilter(i));

        pendingGranths.forEach(v => onAddFilter({ key: 'Name', value: v }));

        // One group per selected series, each with its own volume/number narrowing —
        // keeps independently-narrowed series from being incorrectly ANDed together.
        pendingSeries.forEach(k => {
            const s = seriesByKey[k];
            if (!s) return;
            const group = {
                granth: s.granth,
                series: s.name,
                volume: pendingVolumesBySeries[k] || [],
                pravachan_number: pendingNumbersBySeries[k] || [],
            };
            onAddFilter({ key: '_pravachan_groups', value: JSON.stringify(group) });
        });

        // Granth/Series selection implies a known date range — year filter would conflict
        if (pendingGranths.length > 0 || pendingSeries.length > 0) { setStartYear(null); setEndYear(null); }
        setIsOpen(false);
    };

    const handleClear = () => {
        setPendingGranths([]); setPendingSeries([]);
        setPendingVolumesBySeries({}); setPendingNumbersBySeries({});
        setExpandedGranths([]); setNarrowingKey(null);
        setStartYear(null); setEndYear(null);
    };

    const activeCount = activeFilters.filter(f =>
        PRAVACHAN_FILTER_KEYS.includes(f.key) || (f.key === 'Name' && granthOptions.includes(f.value))
    ).length + (startYear || endYear ? 1 : 0);

    // Year range is a Granth-independent fallback, so it's based on the full cascade.
    const pravachanYears = useMemo(() => extractPravachanYears(cascade), [cascade]);
    const endYearOptions = startYear ? pravachanYears.filter(y => y >= startYear) : pravachanYears;

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className={`flex-1 py-1.5 px-3 border rounded text-sm font-medium flex items-center justify-between transition-colors ${
                    activeCount > 0
                        ? 'border-sky-500 bg-sky-50 text-sky-700'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                style={{ backgroundColor: activeCount > 0 ? undefined : 'var(--bg-surface, white)' }}
            >
                <span>🎙️ Pravachan{activeCount > 0 ? ` (${activeCount})` : ''}</span>
                <svg className="w-3.5 h-3.5 ml-1 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setIsOpen(false)} />
                    <div className="fixed inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center z-50">
                        <div className="bg-white rounded-t-lg md:rounded-lg shadow-2xl w-full md:max-w-lg md:max-h-[85vh] flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                            {/* Header */}
                            <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white rounded-t-lg">
                                <div className="flex items-center gap-2 min-w-0">
                                    {narrowingKey && (
                                        <button onClick={narrowStep === 'numbers' ? () => setNarrowStep('volumes') : closeNarrow}
                                            className="text-slate-400 hover:text-slate-600 mr-1 flex-shrink-0">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                            </svg>
                                        </button>
                                    )}
                                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                        {narrowingKey ? (
                                            <>
                                                <span className="font-bold text-slate-800 text-sm truncate">{narrowSeries?.name}</span>
                                                <span className="text-xs text-slate-400">{narrowSeries?.granth}</span>
                                                <span className="text-xs text-slate-400">· {narrowStep === 'volumes' ? 'Volumes' : 'Pravachan #'}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="font-bold text-slate-800 text-sm">Select Granth &amp; Series</span>
                                                {pendingGranths.map(g => <BreadcrumbChip key={`g-${g}`} label={g} />)}
                                                {pendingSeries.length > 0 && <BreadcrumbChip label={`${pendingSeries.length} series`} />}
                                            </>
                                        )}
                                    </div>
                                </div>
                                <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 flex-shrink-0 ml-2">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Body */}
                            <div className="overflow-y-auto flex-1 p-4">

                                {/* ── Narrow popup: Volumes → Pravachan# for one series ── */}
                                {narrowingKey && narrowStep === 'volumes' && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-slate-500">
                                            {(narrowSeries?.volumes || []).length} volume{(narrowSeries?.volumes || []).length !== 1 ? 's' : ''}
                                        </p>
                                        <div className="grid grid-cols-6 gap-1.5">
                                            {(narrowSeries?.volumes || []).map(v => (
                                                <GridToggle key={v.volume} value={v.volume} selected={narrowVolumes.includes(v.volume)} onToggle={toggleNarrowVolume} />
                                            ))}
                                        </div>
                                        {narrowVolumes.length > 0 && (
                                            <p className="text-xs text-sky-700 font-medium">{narrowVolumes.length} selected</p>
                                        )}
                                    </div>
                                )}
                                {narrowingKey && narrowStep === 'numbers' && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-slate-500">
                                            {narrowAvailableNumbers.length} pravachan{narrowAvailableNumbers.length !== 1 ? 's' : ''} in selected volumes
                                        </p>
                                        <div className="grid grid-cols-6 gap-1 max-h-72 overflow-y-auto pr-1"
                                            style={{ scrollbarWidth: 'thin', scrollbarColor: '#94a3b8 #f1f5f9' }}>
                                            {narrowAvailableNumbers.map(n => (
                                                <GridToggle key={n} value={n} selected={narrowNumbers.includes(n)} onToggle={toggleNarrowNumber} />
                                            ))}
                                        </div>
                                        {narrowNumbers.length > 0 && (
                                            <p className="text-xs text-sky-700 font-medium">{narrowNumbers.length} selected</p>
                                        )}
                                    </div>
                                )}

                                {/* ── Main accordion: Granth & Series ── */}
                                {!narrowingKey && (
                                    <div className="space-y-4">
                                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                                            {granthOptions.length === 0 && (
                                                <p className="p-4 text-sm text-slate-500 text-center">No Granth data available</p>
                                            )}
                                            {granthOptions.map((name) => {
                                                const seriesForGranth = seriesByGranth[name] || [];
                                                const granthChecked = pendingGranths.includes(name);
                                                const selectedCount = seriesForGranth.filter(s => pendingSeries.includes(seriesKey(name, s.name))).length;
                                                const isPartial = !granthChecked && selectedCount > 0 && selectedCount < seriesForGranth.length;
                                                const isExpanded = expandedGranths.includes(name);
                                                return (
                                                    <div key={name} className="border-b border-slate-100 last:border-b-0">
                                                        <div className="flex items-center gap-2 p-3 hover:bg-slate-50">
                                                            <input type="checkbox"
                                                                checked={granthChecked}
                                                                ref={el => { if (el) el.indeterminate = isPartial; }}
                                                                onChange={() => toggleGranth(name)}
                                                                className="form-checkbox h-4 w-4 text-sky-600 rounded flex-shrink-0" />
                                                            <button type="button" onClick={() => toggleGranth(name)}
                                                                className="flex-1 min-w-0 text-left">
                                                                <p className="text-sm font-medium text-slate-800">{name}</p>
                                                            </button>
                                                            {seriesForGranth.length > 0 && (
                                                                <button type="button" onClick={() => toggleExpand(name)}
                                                                    className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0"
                                                                    aria-label={isExpanded ? `Collapse ${name} series` : `Browse ${name} series`}>
                                                                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                                    </svg>
                                                                </button>
                                                            )}
                                                        </div>
                                                        {isExpanded && (
                                                            <div className="bg-slate-50 border-t border-slate-100">
                                                                {seriesForGranth.map(s => {
                                                                    const key = seriesKey(name, s.name);
                                                                    const checked = granthChecked || pendingSeries.includes(key);
                                                                    const nVols = (pendingVolumesBySeries[key] || []).length;
                                                                    const nNums = (pendingNumbersBySeries[key] || []).length;
                                                                    return (
                                                                        <div key={s.name}
                                                                            className="flex items-center gap-3 py-2 pl-10 pr-3 hover:bg-slate-100 border-b border-slate-100 last:border-b-0">
                                                                            <input type="checkbox"
                                                                                checked={checked}
                                                                                onChange={() => toggleSeriesWithinGranth(name, s.name)}
                                                                                className="form-checkbox h-3.5 w-3.5 text-sky-600 rounded flex-shrink-0" />
                                                                            <label className="flex-1 min-w-0 cursor-pointer"
                                                                                onClick={() => toggleSeriesWithinGranth(name, s.name)}>
                                                                                <p className="text-sm text-slate-700">{s.name}</p>
                                                                                {s.start_date && s.end_date && (
                                                                                    <p className="text-xs text-slate-400">
                                                                                        {s.start_date.substring(0, 7)} – {s.end_date.substring(0, 7)}
                                                                                        {' · '}{s.volumes.length} vol{s.volumes.length !== 1 ? 's' : ''}
                                                                                    </p>
                                                                                )}
                                                                            </label>
                                                                            {checked && (
                                                                                <button type="button" onClick={() => openNarrow(name, s.name)}
                                                                                    className="text-xs text-sky-700 hover:text-sky-900 font-medium flex items-center gap-0.5 flex-shrink-0">
                                                                                    {nVols > 0 ? `${nVols} vol${nVols !== 1 ? 's' : ''}` : 'Narrow'}
                                                                                    {nNums > 0 && ` · ${nNums} #`}
                                                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                                                    </svg>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Year range — only show when nothing selected, since a Granth/Series implies a date range */}
                                        {pendingGranths.length === 0 && pendingSeries.length === 0 && (
                                            <div>
                                                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Year Range (Optional)</h4>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <select value={startYear || ''} onChange={e => { const y = e.target.value ? parseInt(e.target.value) : null; setStartYear(y); if (endYear && y && endYear < y) setEndYear(null); }}
                                                        className="p-2 bg-white border border-slate-300 rounded text-slate-800 text-sm focus:ring-2 focus:ring-sky-500">
                                                        <option value="">From year</option>
                                                        {pravachanYears.map(y => <option key={y} value={y}>{y}</option>)}
                                                    </select>
                                                    <select value={endYear || ''} onChange={e => setEndYear(e.target.value ? parseInt(e.target.value) : null)}
                                                        disabled={!startYear}
                                                        className="p-2 bg-white border border-slate-300 rounded text-slate-800 text-sm focus:ring-2 focus:ring-sky-500 disabled:opacity-50">
                                                        <option value="">To year</option>
                                                        {endYearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-slate-200 flex gap-2 sticky bottom-0 bg-white rounded-b-lg">
                                {narrowingKey ? (
                                    <>
                                        <button onClick={closeNarrow}
                                            className="px-4 py-1.5 border border-slate-300 rounded text-slate-700 text-sm font-semibold hover:bg-slate-50">
                                            Done
                                        </button>
                                        <div className="flex-1" />
                                        {narrowStep === 'volumes' && narrowVolumes.length > 0 && narrowAvailableNumbers.length > 0 && (
                                            <button onClick={() => setNarrowStep('numbers')}
                                                className="px-4 py-1.5 border border-sky-400 text-sky-700 rounded text-sm font-semibold hover:bg-sky-50 flex items-center gap-1">
                                                Pravachan #
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <button onClick={handleClear}
                                            className="px-4 py-1.5 border border-slate-300 rounded text-slate-700 text-sm font-semibold hover:bg-slate-50">
                                            Clear
                                        </button>
                                        <div className="flex-1" />
                                        <button onClick={handleApply}
                                            className="px-4 py-1.5 bg-sky-600 text-white rounded text-sm font-semibold hover:bg-sky-700">
                                            Apply
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

// ─── GranthFilter ────────────────────────────────────────────────────────────

const GranthFilter = ({ allMetadata, activeFilters, onAddFilter, onRemoveFilter, language }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [pending, setPending]   = useState([]);
    const [search, setSearch]     = useState('');

    const allNames = useMemo(() => {
        const items = new Set();
        ['Pravachan', 'Granth', 'Books'].forEach(cat => {
            (allMetadata?.[cat]?.[language]?.Name || []).forEach(n => items.add(n));
        });
        return Array.from(items).sort();
    }, [allMetadata, language]);

    const filtered = allNames.filter(n => n.toLowerCase().includes(search.toLowerCase()));

    useEffect(() => {
        if (!isOpen) return;
        setPending(activeFilters.filter(f => f.key === 'Name').map(f => f.value));
        setSearch('');
    }, [isOpen]); // eslint-disable-line

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen]);

    const toggle = (name) =>
        setPending(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);

    const handleApply = () => {
        const toRemove = [];
        activeFilters.forEach((f, i) => { if (f.key === 'Name') toRemove.push(i); });
        toRemove.reverse().forEach(i => onRemoveFilter(i));
        pending.forEach(v => onAddFilter({ key: 'Name', value: v }));
        setIsOpen(false);
    };

    const handleClear = () => { setPending([]); setSearch(''); };

    const activeCount = activeFilters.filter(f => f.key === 'Name').length;

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className={`flex-1 py-1.5 px-3 border rounded text-sm font-medium flex items-center justify-between transition-colors ${
                    activeCount > 0
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                style={{ backgroundColor: activeCount > 0 ? undefined : 'var(--bg-surface, white)' }}
            >
                <span>📜 Granth{activeCount > 0 ? ` (${activeCount})` : ''}</span>
                <svg className="w-3.5 h-3.5 ml-1 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setIsOpen(false)} />
                    <div className="fixed inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center z-50">
                        <div className="bg-white rounded-t-lg md:rounded-lg shadow-2xl w-full md:max-w-lg md:max-h-[85vh] flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                            {/* Header */}
                            <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white rounded-t-lg">
                                <h3 className="text-base font-bold text-slate-800">Filter by Granth</h3>
                                <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Search */}
                            <div className="px-4 pt-3 pb-2">
                                <input
                                    type="text"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Search granths..."
                                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm text-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white"
                                />
                            </div>

                            {/* List */}
                            <div className="overflow-y-auto flex-1 px-4 pb-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#94a3b8 #f1f5f9' }}>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    {filtered.length === 0 && (
                                        <p className="p-4 text-sm text-slate-500 text-center">No granths found</p>
                                    )}
                                    {filtered.map((name) => (
                                        <label key={name}
                                            className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0">
                                            <input type="checkbox"
                                                checked={pending.includes(name)}
                                                onChange={() => toggle(name)}
                                                className="form-checkbox h-4 w-4 text-emerald-600 rounded" />
                                            <span className="text-sm text-slate-800 flex-1">{name}</span>
                                            {pending.includes(name) && (
                                                <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </label>
                                    ))}
                                </div>
                                {pending.length > 0 && (
                                    <p className="text-xs text-emerald-700 font-medium mt-2">{pending.length} selected</p>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-slate-200 flex gap-2 sticky bottom-0 bg-white rounded-b-lg">
                                <button onClick={handleClear}
                                    className="flex-1 px-4 py-1.5 border border-slate-300 rounded text-slate-700 text-sm font-semibold hover:bg-slate-50">
                                    Clear
                                </button>
                                <button onClick={handleApply}
                                    className="flex-1 px-4 py-1.5 bg-emerald-600 text-white rounded text-sm font-semibold hover:bg-emerald-700">
                                    Apply{pending.length > 0 ? ` (${pending.length})` : ''}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

// ─── SearchFilters (public wrapper) ──────────────────────────────────────────

const CHIP_COLORS = {
    _pravachan_groups: 'bg-violet-100 text-violet-800 border-violet-200',
    Name:              'bg-sky-100 text-sky-800 border-sky-200',
};
const CHIP_LABELS = {
    Name: '',
};

// Builds a human label for a _pravachan_groups chip, e.g. "1979 Series (Vol 3)".
const pravachanGroupChipLabel = (jsonValue) => {
    try {
        const g = JSON.parse(jsonValue);
        const parts = [g.series];
        if (g.volume?.length) parts.push(`Vol ${g.volume.join(', ')}`);
        if (g.pravachan_number?.length) parts.push(`# ${g.pravachan_number.join(', ')}`);
        return `${parts[0]}${parts.length > 1 ? ` (${parts.slice(1).join(' · ')})` : ''}`;
    } catch {
        return jsonValue;
    }
};

export const SearchFilters = ({
    allMetadata, activeFilters, onAddFilter, onRemoveFilter,
    language, startYear, setStartYear, endYear, setEndYear,
    activeCategories = ['Pravachan', 'Granth'],
    // kept for compat but not used — content type handled separately
    contentTypes, setContentTypes,
}) => {
    const hasYearFilter = startYear || endYear;
    const hasAnyFilter  = activeFilters.length > 0 || hasYearFilter;

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-900 font-semibold uppercase tracking-wide">Refine search</p>

            <div className="flex gap-2">
                {activeCategories.includes('Pravachan') && (
                    <PravachanFilter
                        allMetadata={allMetadata}
                        activeFilters={activeFilters}
                        onAddFilter={onAddFilter}
                        onRemoveFilter={onRemoveFilter}
                        language={language}
                        startYear={startYear}
                        setStartYear={setStartYear}
                        endYear={endYear}
                        setEndYear={setEndYear}
                    />
                )}
                {(activeCategories.includes('Granth') || activeCategories.includes('Books')) && (
                    <GranthFilter
                        allMetadata={allMetadata}
                        activeFilters={activeFilters}
                        onAddFilter={onAddFilter}
                        onRemoveFilter={onRemoveFilter}
                        language={language}
                    />
                )}
            </div>

            {/* Active filter chips */}
            {hasAnyFilter && (
                <div className="flex flex-wrap gap-1.5 items-center">
                    {activeFilters.map((f, i) => {
                        const color = CHIP_COLORS[f.key] || 'bg-slate-100 text-slate-700 border-slate-200';
                        const prefix = CHIP_LABELS[f.key];
                        const label = f.key === '_pravachan_groups'
                            ? pravachanGroupChipLabel(f.value)
                            : (prefix ? `${prefix}: ${f.value}` : f.value);
                        return (
                            <span key={i} className={`${color} border text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1`}>
                                {label}
                                <button onClick={() => onRemoveFilter(i)} className="opacity-60 hover:opacity-100 font-bold leading-none">&times;</button>
                            </span>
                        );
                    })}
                    {hasYearFilter && (
                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                            {startYear || '?'} – {endYear || '?'}
                            <button onClick={() => { setStartYear(null); setEndYear(null); }} className="opacity-60 hover:opacity-100 font-bold leading-none">&times;</button>
                        </span>
                    )}
                    {hasAnyFilter && (
                        <button
                            onClick={() => {
                                [...activeFilters].map((_, i) => i).reverse().forEach(i => onRemoveFilter(i));
                                setStartYear(null); setEndYear(null);
                            }}
                            className="text-xs text-slate-400 hover:text-slate-600 underline ml-1"
                        >
                            Clear all
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export const AdvancedSearch = ({ textSearch, setTextSearch, exactMatch, setExactMatch, excludeWords, setExcludeWords }) => {
    const [showTextSearchTooltip, setShowTextSearchTooltip] = useState(false);
    const [showExactMatchTooltip, setShowExactMatchTooltip] = useState(false);
    const [showExcludeWordsTooltip, setShowExcludeWordsTooltip] = useState(false);

    const handleTextSearchChange = (checked) => {
        setTextSearch(checked);
        if (!checked) setExactMatch(false);
    };

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-900 font-semibold uppercase tracking-wide">Advanced search</p>
            <div className="space-y-2.5">
                {/* Text Search toggle */}
                <div className="relative flex items-center gap-2">
                    <label className="flex items-center gap-2 text-slate-700 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={textSearch}
                            onChange={(e) => handleTextSearchChange(e.target.checked)}
                            className="form-checkbox h-3.5 w-3.5 text-sky-600 focus:ring-sky-500 rounded"
                        />
                        <span className="text-sm">Text search</span>
                    </label>
                    <button
                        type="button"
                        className="text-slate-300 hover:text-slate-600 transition-colors"
                        onMouseEnter={() => setShowTextSearchTooltip(true)}
                        onMouseLeave={() => setShowTextSearchTooltip(false)}
                        onClick={() => setShowTextSearchTooltip(!showTextSearchTooltip)}
                    >
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {showTextSearchTooltip && (
                        <div className="absolute left-0 top-full mt-1 bg-slate-800 text-white text-xs rounded px-2 py-1 z-10 whitespace-nowrap">
                            Force keyword-based search instead of semantic (vector) search
                        </div>
                    )}
                </div>

                {/* Exact phrase match — only shown when Text Search is enabled */}
                {textSearch && (
                <div className="relative flex items-center gap-2 pl-5">
                    <label className="flex items-center gap-2 text-slate-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={exactMatch}
                            onChange={(e) => setExactMatch(e.target.checked)}
                            className="form-checkbox h-3.5 w-3.5 text-sky-600 focus:ring-sky-500 rounded"
                        />
                        <span className="text-sm">Exact phrase match</span>
                    </label>
                    <button
                        type="button"
                        className="text-slate-300 hover:text-slate-600 transition-colors"
                        onMouseEnter={() => setShowExactMatchTooltip(true)}
                        onMouseLeave={() => setShowExactMatchTooltip(false)}
                        onClick={() => setShowExactMatchTooltip(!showExactMatchTooltip)}
                    >
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {showExactMatchTooltip && (
                        <div className="absolute left-0 top-full mt-1 bg-slate-800 text-white text-xs rounded px-2 py-1 z-10 whitespace-nowrap">
                            Search for the exact phrase rather than individual words
                        </div>
                    )}
                </div>
                )}

                {/* Exclude Words */}
                <div className="relative">
                    <div className="flex items-center gap-1 mb-1">
                        <span className="text-xs text-slate-600">Exclude words</span>
                        <button
                            type="button"
                            className="text-slate-300 hover:text-slate-600 transition-colors"
                            onMouseEnter={() => setShowExcludeWordsTooltip(true)}
                            onMouseLeave={() => setShowExcludeWordsTooltip(false)}
                            onClick={() => setShowExcludeWordsTooltip(!showExcludeWordsTooltip)}
                        >
                            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                            </svg>
                        </button>
                        {showExcludeWordsTooltip && (
                            <div className="absolute left-0 top-full mt-1 bg-slate-800 text-white text-xs rounded px-2 py-1 z-10 whitespace-nowrap">
                                Comma-separated words to exclude from results
                            </div>
                        )}
                    </div>
                    <input
                        type="text"
                        value={excludeWords}
                        onChange={(e) => setExcludeWords(e.target.value)}
                        placeholder="word1, word2, ..."
                        style={{ backgroundColor: 'var(--bg-surface, white)' }}
                        className="w-full py-1 px-2.5 bg-white border border-slate-200 rounded text-slate-800 text-sm focus:ring-1 focus:ring-sky-500 focus:border-sky-400 font-sans"
                    />
                </div>
            </div>
        </div>
    );
};

export const SearchOptions = ({ language, setLanguage, inline = false }) => {
    const toggle = (
        <div style={{ backgroundColor: 'var(--bg-surface, #f5f5f5)' }} className="flex items-center p-0.5 bg-neutral-100 rounded w-fit">
            {[{ value: 'hindi', label: 'हिन्दी' }, { value: 'gujarati', label: 'ગુજરાતી' }].map(lang => (
                <button
                    key={lang.value}
                    onClick={() => setLanguage(lang.value)}
                    className={`px-3 py-0.5 text-sm font-medium rounded transition-all duration-150 ${
                        language === lang.value
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-600'
                    }`}
                >
                    {lang.label}
                </button>
            ))}
        </div>
    );

    if (inline) {
        return <div className="shrink-0">{toggle}</div>;
    }

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-900 font-semibold uppercase tracking-wide">Language</p>
            {toggle}
        </div>
    );
};
