import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';

// Import components
import { Navigation, Header } from './components/Navigation';
import { SearchBar, MetadataFilters, AdvancedSearch, SearchOptions } from './components/SearchInterface';
import { ResultsList, SuggestionsCard, Tabs, SimilarSourceInfoCard } from './components/SearchResults';
import { ExpandModal, GranthVerseModal, GranthProseModal, WelcomeModal } from './components/Modals';
import { FeedbackForm } from './components/Feedback';
import About from './components/About';
import WhatsNew from './components/WhatsNew';
import UsageGuide from './components/UsageGuide';
import SearchIndex from './components/SearchIndex';
import UIEval from './components/eval/UIEval';
import SearchableContentWidget from './components/SearchableContentWidget';
import { Spinner, ChevronUpIcon, ChevronDownIcon, ExpandIcon } from './components/SharedComponents';

// Import API service
import { api } from './services/api';

// --- TIPS MODAL COMPONENT ---
const TipsModal = ({ onClose }) => {
    // Effect to handle 'Escape' key press for closing the modal
    useEffect(() => {
        const handleEsc = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEsc);

        // Cleanup the event listener on component unmount
        return () => {
            window.removeEventListener('keydown', handleEsc);
        };
    }, [onClose]);

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div 
                className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-slate-200 sticky top-0 bg-white">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-slate-800">Tips to write good queries</h2>
                        <button onClick={onClose} className="text-slate-500 hover:text-slate-700 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="p-6">
                    <ul className="space-y-4 text-slate-700">
                        <li className="flex items-start">
                            <span className="text-sky-500 font-bold mr-3">1.</span>
                            <span>Write in Hindi for the most accurate results.</span>
                        </li>
                        <li className="flex items-start">
                            <span className="text-sky-500 font-bold mr-3">2.</span>
                            <span>For questions or specific phrases, end with punctuation like a question mark (?) or a Purn Viram (।).</span>
                        </li>
                        <li className="flex items-start">
                            <span className="text-sky-500 font-bold mr-3">3.</span>
                            <span>If writing in English, avoid mixing in Hindi words written in the English alphabet (Hinglish).</span>
                        </li>
                    </ul>
                    <div className="mt-6">
                        <h3 className="text-lg font-semibold text-slate-800 mb-3">Examples:</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <p className="font-semibold mb-2">✅ Right</p>
                                <ul className="space-y-2">
                                    <li className="bg-green-50 border border-green-200 rounded-md p-2">"कुन्दकुन्दाचार्य विदेह"</li>
                                    <li className="bg-green-50 border border-green-200 rounded-md p-2">"शुद्धभाव अधिकार"</li>
                                    <li className="bg-green-50 border border-green-200 rounded-md p-2">"सम्यक् एकांत"</li>
                                    <li className="bg-green-50 border border-green-200 rounded-md p-2">"दृष्टि का विषय क्या है?"</li>
                                    <li className="bg-green-50 border border-green-200 rounded-md p-2">"कुन्दकुन्दाचार्य विदेह क्षेत्र कब गए थे?"</li>
                                    <li className="bg-green-50 border border-green-200 rounded-md p-2">"Where does Seemandhar God reside?"</li>
                                </ul>
                            </div>
                            <div>
                                <p className="font-semibold mb-2">❌ Wrong</p>
                                <ul className="space-y-2">
                                    <li className="bg-red-50 border border-red-200 rounded-md p-2">"सम्यक् एकांत क्या है"</li>
                                    <li className="bg-red-50 border border-red-200 rounded-md p-2">"Kundkund Acharya kaun hai?"</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    
                    {/* Link to Typing Guide */}
                    <div className="mt-6 pt-4 border-t border-slate-200">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <div className="flex items-start">
                                <svg className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                                <div>
                                    <h4 className="font-semibold text-amber-800 mb-1">Need help typing in Hindi/Gujarati?</h4>
                                    <p className="text-amber-700 text-sm mb-3">
                                        Learn how to set up Hindi and Gujarati typing on your device for better search results.
                                    </p>
                                    <button
                                        onClick={() => {
                                            onClose();
                                            window.location.href = '/usage-guide#typing-guide';
                                        }}
                                        className="bg-amber-600 text-white text-sm font-semibold py-2 px-4 rounded-md hover:bg-amber-700 transition-colors duration-200"
                                    >
                                        View Typing Setup Guide
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---
const AppContent = () => {
    const location = useLocation();
    const navigate = useNavigate();
    
    // State to track current page selection
    const [currentPageState, setCurrentPageState] = useState(() => {
        const path = location.pathname;
        if (path === '/about') return 'about';
        if (path === '/feedback') return 'feedback';
        if (path === '/whats-new') return 'whats-new';
        if (path === '/usage-guide') return 'usage-guide';
        if (path === '/search-index') return 'search-index';
        if (path === '/eval') return 'eval';
        return 'home'; // Default to 'home' for root path
    });
    
    // Update state when URL changes (browser navigation)
    useEffect(() => {
        const path = location.pathname;
        if (path === '/about') {
            setCurrentPageState('about');
        } else if (path === '/feedback') {
            setCurrentPageState('feedback');
        } else if (path === '/whats-new') {
            setCurrentPageState('whats-new');
        } else if (path === '/usage-guide') {
            setCurrentPageState('usage-guide');
        } else if (path === '/search-index') {
            setCurrentPageState('search-index');
        } else if (path === '/eval') {
            setCurrentPageState('eval');
        } else if (path === '/') {
            setCurrentPageState('home');
        }
    }, [location.pathname]);
    
    // Reset function to clear all search state
    const resetSearchState = () => {
        setQuery('');
        setActiveFilters([]);
        setLanguage('hindi');
        setExactMatch(false);
        setExcludeWords('');
        setShowFilters(true);
        setStartYear(null);
        setEndYear(null);
        setSearchData(null);
        setIsLoading(false);
        setActiveTab('pravachan');
        setPravachanPage(1);
        setGranthPage(1);
        setSimilarDocsPage(1);
        setSimilarDocumentsData(null);
        setSourceDocForSimilarity(null);
        setModalData(null);
        setIsContextLoading(false);
        setShowTipsModal(false);
    };

    const currentPage = currentPageState;
    const setCurrentPage = (page) => {
        setCurrentPageState(page);
        
        // Reset search state when navigating to Home
        if (page === 'home') {
            resetSearchState();
        }
        
        const routes = {
            'home': '/',
            'about': '/about',
            'feedback': '/feedback',
            'whats-new': '/whats-new',
            'usage-guide': '/usage-guide',
            'search-index': '/search-index',
            'eval': '/eval'
        };
        navigate(routes[page] || '/');
    };
    const [query, setQuery] = useState('');
    const [activeFilters, setActiveFilters] = useState([]);
    const [contentTypes, setContentTypes] = useState({ pravachans: true, granths: true });
    const [language, setLanguage] = useState('hindi');
    const [exactMatch, setExactMatch] = useState(false);
    const [excludeWords, setExcludeWords] = useState('');
    const [searchType] = useState('relevance'); // Always use better relevance
    const [showFilters, setShowFilters] = useState(true);
    const [startYear, setStartYear] = useState(null);
    const [endYear, setEndYear] = useState(null);
    const [allMetadata, setAllMetadata] = useState({});
    const [metadata, setMetadata] = useState({});
    const [searchData, setSearchData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('pravachan');
    const [pravachanPage, setPravachanPage] = useState(1);
    const [granthPage, setGranthPage] = useState(1);
    const [similarDocsPage, setSimilarDocsPage] = useState(1);
    const [similarDocumentsData, setSimilarDocumentsData] = useState(null);
    const [sourceDocForSimilarity, setSourceDocForSimilarity] = useState(null);
    const [modalData, setModalData] = useState(null);
    const [isContextLoading, setIsContextLoading] = useState(false);
    const [granthVerseData, setGranthVerseData] = useState(null);
    const [isGranthVerseLoading, setIsGranthVerseLoading] = useState(false);
    const [granthProseData, setGranthProseData] = useState(null);
    const [isGranthProseLoading, setIsGranthProseLoading] = useState(false);
    const [showWelcomePopup, setShowWelcomePopup] = useState(false);
    const [showTipsModal, setShowTipsModal] = useState(false);
    const PAGE_SIZE = 20;

    useEffect(() => {
        api.getMetadata().then(data => {
            setAllMetadata(data);
            // Set initial metadata based on default content type (Pravachan) and language
            setMetadata(data['Pravachan']?.[language] || {});
        });
    }, []);

    // Update metadata when language or contentTypes selection changes
    useEffect(() => {
        if (allMetadata) {
            let newMetadata = {};

            // Determine which metadata to show based on contentTypes selection
            if (contentTypes.pravachans && !contentTypes.granths) {
                // Only Pravachan selected
                newMetadata = allMetadata['Pravachan']?.[language] || {};
            } else if (!contentTypes.pravachans && contentTypes.granths) {
                // Only Granth selected
                newMetadata = allMetadata['Granth']?.[language] || {};
            } else if (contentTypes.pravachans && contentTypes.granths) {
                // Both selected - merge metadata from both content types
                const pravachanMetadata = allMetadata['Pravachan']?.[language] || {};
                const granthMetadata = allMetadata['Granth']?.[language] || {};

                // Merge by combining values for each field
                newMetadata = { ...pravachanMetadata };
                Object.keys(granthMetadata).forEach(key => {
                    if (newMetadata[key]) {
                        // Merge and deduplicate values
                        newMetadata[key] = [...new Set([...newMetadata[key], ...granthMetadata[key]])].sort();
                    } else {
                        newMetadata[key] = granthMetadata[key];
                    }
                });
            }

            setMetadata(newMetadata);
            // Clear existing filters when language or content type changes as they may not be valid
            setActiveFilters([]);
        }
    }, [language, contentTypes, allMetadata]);

    useEffect(() => {
        try {
            const hasVisited = localStorage.getItem('aagamKhojHasVisited');
            if (!hasVisited) {
                setShowWelcomePopup(true);
                localStorage.setItem('aagamKhojHasVisited', 'true');
            }
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, []);
    
    const addFilter = (filter) => {
        setActiveFilters(prevFilters => {
            // Check if filter already exists
            if (prevFilters.some(f => f.key === filter.key && f.value === filter.value)) {
                return prevFilters;
            }
            return [...prevFilters, filter];
        });
    };

    const removeFilter = (index) => {
        setActiveFilters(prevFilters => prevFilters.filter((_, i) => i !== index));
    };

    // Single source of truth for building search payload
    const buildSearchPayload = useCallback((pravachanPage = 1, granthPage = 1) => {
        return {
            query,
            exact_match: exactMatch,
            exclude_words: excludeWords.split(',').map(word => word.trim()).filter(word => word.length > 0),
            categories: activeFilters.reduce((acc, f) => ({ ...acc, [f.key]: [...(acc[f.key] || []), f.value] }), {}),
            language: language,
            search_types: {
                "Pravachan": {
                    "enabled": contentTypes.pravachans,
                    "page_size": PAGE_SIZE,
                    "page_number": pravachanPage
                },
                "Granth": {
                    "enabled": contentTypes.granths,
                    "page_size": PAGE_SIZE,
                    "page_number": granthPage
                }
            },
            enable_reranking: searchType === 'relevance',
            ...(startYear && { start_year: startYear }),
            ...(endYear && { end_year: endYear })
        };
    }, [query, activeFilters, contentTypes, language, exactMatch, excludeWords, searchType, startYear, endYear]);

    const handleSearch = useCallback(async (page = 1) => {
        if (!query.trim()) {
            alert("Please enter a search query.");
            return;
        }
        setIsLoading(true);
        setPravachanPage(page);
        setSimilarDocumentsData(null);
        setSourceDocForSimilarity(null);

        const requestPayload = buildSearchPayload(1, 1);
        const data = await api.search(requestPayload);
        setSearchData(data);

        if (data.pravachan_results?.total_hits > 0) {
            setActiveTab('pravachan');
        } else if (data.granth_results?.total_hits > 0) {
            setActiveTab('granth');
        }
        setIsLoading(false);
    }, [query, buildSearchPayload]);

    const handlePravachanSearch = useCallback(async (page = 1) => {
        if (!query.trim()) {
            return;
        }
        setIsLoading(true);
        setPravachanPage(page);

        const requestPayload = buildSearchPayload(page, 1);
        const data = await api.search(requestPayload);
        setSearchData(data);
        setIsLoading(false);
    }, [query, buildSearchPayload]);

    const handleGranthSearch = useCallback(async (page = 1) => {
        if (!query.trim()) {
            return;
        }
        setIsLoading(true);
        setGranthPage(page);

        const requestPayload = buildSearchPayload(1, page);
        const data = await api.search(requestPayload);
        setSearchData(data);
        setIsLoading(false);
    }, [query, buildSearchPayload]);

    const handleFindSimilar = async (sourceDoc) => {
        setIsLoading(true); 
        setSourceDocForSimilarity(sourceDoc); 
        setSimilarDocsPage(1);
        const data = await api.getSimilarDocuments(sourceDoc.document_id);
        setSimilarDocumentsData(data); 
        setActiveTab('similar'); 
        setIsLoading(false);
    };

    const handleExpand = async (chunkId) => {
        setIsContextLoading(true);
        setModalData({ previous: null, current: null, next: null });
        const data = await api.getParagraphContext(chunkId);
        setModalData(data);
        setIsContextLoading(false);
    };

    const handleExpandGranth = async (originalFilename, seqNum, contentType) => {
        if (contentType === 'verse') {
            setIsGranthVerseLoading(true);
            setGranthVerseData(null);
            const data = await api.getGranthVerse(originalFilename, seqNum);
            setGranthVerseData(data);
            setIsGranthVerseLoading(false);
        } else if (contentType === 'prose') {
            setIsGranthProseLoading(true);
            setGranthProseData(null);
            const data = await api.getGranthProse(originalFilename, seqNum);
            setGranthProseData(data);
            setIsGranthProseLoading(false);
        }
    };

    const handleCloseModal = () => setModalData(null);

    const handleCloseGranthVerseModal = () => setGranthVerseData(null);

    const handleCloseGranthProseModal = () => setGranthProseData(null);

    const handleWelcomeClose = () => {
        setShowWelcomePopup(false);
    };

    const handleWelcomeGoToUsageGuide = () => {
        setShowWelcomePopup(false);
        setCurrentPage('about');
    };

    const handleClearSimilar = () => {
        setSimilarDocumentsData(null);
        setSourceDocForSimilarity(null);
        if (searchData?.pravachan_results?.total_hits > 0) {
            setActiveTab('pravachan');
        } else if (searchData?.granth_results?.total_hits > 0) {
            setActiveTab('granth');
        }
    };

    const handleSuggestionClick = (suggestion) => {
        setQuery(suggestion);
        setIsLoading(true);
        setPravachanPage(1);
        setSimilarDocumentsData(null);
        setSourceDocForSimilarity(null);

        // Temporarily override query state for building payload
        const requestPayload = {
            ...buildSearchPayload(1, 1),
            query: suggestion  // Override with suggestion
        };

        api.search(requestPayload).then(data => {
            setSearchData(data);
            if (data.pravachan_results?.total_hits > 0) {
                setActiveTab('pravachan');
            } else if (data.granth_results?.total_hits > 0) {
                setActiveTab('granth');
            }
            setIsLoading(false);
        });
    };

    const handlePageChange = (page) => {
        // Scroll to top when changing pages
        window.scrollTo({ top: 0, behavior: 'smooth' });

        switch (activeTab) {
            case 'pravachan':
                handlePravachanSearch(page);
                break;
            case 'granth':
                handleGranthSearch(page);
                break;
            case 'similar':
                setSimilarDocsPage(page);
                break;
            default:
                break;
        }
    };

    const getPaginatedResults = (results, page) => {
        if (!results) return [];
        return results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    };

    const paginatedSimilarResults = getPaginatedResults(similarDocumentsData?.results, similarDocsPage);

    const showSearchInterface = currentPage === 'home';

    return (
        <div className="bg-slate-50 text-slate-900 min-h-screen font-sans">
            {modalData && (
                <ExpandModal
                    data={modalData}
                    onClose={handleCloseModal}
                    isLoading={isContextLoading}
                />
            )}

            {granthVerseData && (
                <GranthVerseModal
                    verse={granthVerseData.verse}
                    granthName={granthVerseData.granth_name}
                    metadata={granthVerseData.metadata}
                    onClose={handleCloseGranthVerseModal}
                    isLoading={isGranthVerseLoading}
                />
            )}

            {granthProseData && (
                <GranthProseModal
                    prose={granthProseData.prose}
                    granthName={granthProseData.granth_name}
                    metadata={granthProseData.metadata}
                    onClose={handleCloseGranthProseModal}
                    isLoading={isGranthProseLoading}
                />
            )}

            {showWelcomePopup && (
                <WelcomeModal
                    onClose={handleWelcomeClose}
                    onGoToUsageGuide={handleWelcomeGoToUsageGuide}
                />
            )}

            {showTipsModal && <TipsModal onClose={() => setShowTipsModal(false)} />}
            
            <Navigation currentPage={currentPage} setCurrentPage={setCurrentPage} />
            
            <div className="container mx-auto p-4 md:p-5">
                <div className="max-w-[1080px] mx-auto">
                    <Header currentPage={currentPage} />

                    {showSearchInterface && (
                        <main>
                            <SearchableContentWidget />
                            <div className="bg-white p-3 md:p-4 rounded-lg shadow-sm border border-slate-200 mb-4">
                                {/* Row 1: Search Bar and Button */}
                                <div className="flex items-center gap-2">
                                    <div className="flex-grow">
                                        <SearchBar
                                            query={query}
                                            setQuery={setQuery}
                                            onSearch={() => handleSearch(1)}
                                            language={language}
                                        />
                                    </div>
                                    <button
                                        onClick={() => handleSearch(1)}
                                        disabled={isLoading}
                                        className="bg-sky-600 text-white font-bold py-3 px-4 rounded-md text-base hover:bg-sky-700 transition duration-300 disabled:bg-slate-300 flex items-center justify-center"
                                    >
                                        {isLoading ? <Spinner /> : 'Search'}
                                    </button>
                                </div>

                                {/* Row 2: Filters and Info */}
                                <div className="flex items-center justify-between mt-3">
                                    <div>
                                        <button
                                            onClick={() => setShowFilters(!showFilters)}
                                            className="flex items-center text-sky-700 font-semibold hover:text-sky-800 text-sm whitespace-nowrap"
                                        >
                                            {showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
                                            {showFilters ? 'Hide Filters' : 'Show Filters'}
                                        </button>
                                    </div>
                                    <div>
                                        <button
                                            onClick={() => setShowTipsModal(true)}
                                            className="flex items-center text-sky-700 font-semibold hover:text-sky-800 text-sm"
                                            aria-label="Show search tips"
                                        >
                                            <ExpandIcon />
                                            Tips for writing good queries
                                        </button>
                                    </div>
                                </div>

                                {/* Filters section that shows/hides */}
                                {showFilters && (
                                    <div className="mt-4 border-t border-slate-200 pt-4">
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                            <MetadataFilters
                                                metadata={allMetadata}
                                                activeFilters={activeFilters}
                                                onAddFilter={addFilter}
                                                onRemoveFilter={removeFilter}
                                                contentTypes={contentTypes}
                                                setContentTypes={setContentTypes}
                                                language={language}
                                                startYear={startYear}
                                                setStartYear={setStartYear}
                                                endYear={endYear}
                                                setEndYear={setEndYear}
                                            />
                                            <SearchOptions
                                                language={language}
                                                setLanguage={setLanguage}
                                            />
                                            <AdvancedSearch
                                                exactMatch={exactMatch}
                                                setExactMatch={setExactMatch}
                                                excludeWords={excludeWords}
                                                setExcludeWords={setExcludeWords}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {isLoading && (
                                <div className="text-center py-8">
                                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
                                    <p className="mt-3 text-base text-slate-500">Searching...</p>
                                </div>
                            )}
                            
                            {!isLoading && (searchData || similarDocumentsData) && (
                                <div className="mt-4">
                                    <SuggestionsCard
                                        suggestions={searchData?.suggestions}
                                        originalQuery={query}
                                        onSuggestionClick={handleSuggestionClick}
                                        hasResults={(searchData?.pravachan_results?.total_hits || 0) > 0 || (searchData?.granth_results?.total_hits || 0) > 0}
                                    />
                                    <Tabs 
                                        activeTab={activeTab} 
                                        setActiveTab={setActiveTab} 
                                        searchData={searchData} 
                                        similarDocumentsData={similarDocumentsData} 
                                        onClearSimilar={handleClearSimilar} 
                                    />
                                    {activeTab === 'pravachan' && searchData?.pravachan_results?.results.length > 0 && (
                                        <ResultsList
                                            results={searchData.pravachan_results.results}
                                            totalResults={searchData.pravachan_results.total_hits}
                                            pageSize={PAGE_SIZE}
                                            currentPage={pravachanPage}
                                            onPageChange={handlePageChange}
                                            resultType="pravachan"
                                            onFindSimilar={handleFindSimilar}
                                            onExpand={handleExpand}
                                            searchType={searchType}
                                            query={query}
                                            currentFilters={activeFilters}
                                            language={language}
                                        />
                                    )}
                                    {activeTab === 'granth' && searchData?.granth_results?.results.length > 0 && (
                                        <ResultsList
                                            results={searchData.granth_results.results}
                                            totalResults={searchData.granth_results.total_hits}
                                            pageSize={PAGE_SIZE}
                                            currentPage={granthPage}
                                            onPageChange={handlePageChange}
                                            resultType="granth"
                                            onFindSimilar={handleFindSimilar}
                                            onExpand={handleExpand}
                                            onExpandGranth={handleExpandGranth}
                                            searchType={searchType}
                                            query={query}
                                            currentFilters={activeFilters}
                                            language={language}
                                        />
                                    )}
                                    {activeTab === 'similar' && (
                                        <div className="bg-white p-3 md:p-4 rounded-b-md">
                                            <SimilarSourceInfoCard sourceDoc={sourceDocForSimilarity} />
                                            {similarDocumentsData?.results.length > 0 ? (
                                                <ResultsList 
                                                    results={paginatedSimilarResults} 
                                                    totalResults={similarDocumentsData.total_results} 
                                                    pageSize={PAGE_SIZE} 
                                                    currentPage={similarDocsPage} 
                                                    onPageChange={handlePageChange} 
                                                    resultType="similar" 
                                                    onFindSimilar={handleFindSimilar} 
                                                    onExpand={handleExpand} 
                                                    searchType={searchType}
                                                    query={query}
                                                    currentFilters={activeFilters}
                                                    language={language} 
                                                />
                                            ) : (
                                                <div className="text-center py-8 text-base text-slate-500">
                                                    No similar documents found.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {!isLoading && !searchData && (
                                <div className="text-center py-8 text-base text-slate-500 bg-white rounded-lg border border-slate-200">
                                    Enter a query and click Search to see results.
                                </div>
                            )}
                        </main>
                    )}

                    {currentPage === 'feedback' && (
                        <main>
                            <GoogleReCaptchaProvider
                                reCaptchaKey={process.env.REACT_APP_RECAPTCHA_SITE_KEY || "__REACT_APP_RECAPTCHA_SITE_KEY__"}
                            >
                                <FeedbackForm onReturnToAagamKhoj={() => setCurrentPage('home')} />
                            </GoogleReCaptchaProvider>
                        </main>
                    )}

                    {currentPage === 'about' && (
                        <main>
                            <About />
                        </main>
                    )}

                    {currentPage === 'whats-new' && (
                        <main>
                            <WhatsNew />
                        </main>
                    )}

                    {currentPage === 'usage-guide' && (
                        <main>
                            <UsageGuide />
                        </main>
                    )}

                    {currentPage === 'search-index' && (
                        <main>
                            <SearchIndex />
                        </main>
                    )}

                    {currentPage === 'eval' && (
                        <main>
                            <UIEval />
                        </main>
                    )}
                </div>
            </div>
            
            {/* Mobile Navigation Buttons - Only visible on mobile */}
            {currentPage !== 'feedback' && (
                <button
                    onClick={() => setCurrentPage('feedback')}
                    className="md:hidden fixed bottom-6 right-6 bg-sky-600 text-white p-3 rounded-full shadow-lg hover:bg-sky-700 transition-colors duration-200 z-50"
                    aria-label="Feedback"
                >
                    {/* Email icon for feedback */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </button>
            )}
            
            {currentPage !== 'home' && (
                <button
                    onClick={() => setCurrentPage('home')}
                    className="md:hidden fixed bottom-6 left-6 bg-slate-600 text-white p-3 rounded-full shadow-lg hover:bg-slate-700 transition-colors duration-200 z-50"
                    aria-label="Home"
                >
                    {/* Home icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                </button>
            )}
        </div>
    );
};

// Main App wrapper with Router
export default function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<AppContent />} />
                <Route path="/about" element={<AppContent />} />
                <Route path="/feedback" element={<AppContent />} />
                <Route path="/whats-new" element={<AppContent />} />
                <Route path="/usage-guide" element={<AppContent />} />
                <Route path="/search-index" element={<AppContent />} />
                <Route path="/eval" element={<AppContent />} />
            </Routes>
        </Router>
    );
}
