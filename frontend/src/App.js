import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';

// Import components
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import AdminLoginPage from './components/admin/AdminLogin';
import AdminPageComponent from './components/admin/AdminPage';
import { SearchBar, MetadataFilters, SearchFilters, AdvancedSearch, SearchOptions } from './components/SearchInterface';
import { ResultsList, SuggestionsCard, Tabs, SimilarSourceInfoCard, SkeletonResultsList } from './components/SearchResults';
import { ExpandModal, GranthVerseModal, GranthProseModal, WelcomeModal } from './components/Modals';
import { FeedbackForm } from './components/Feedback';
import Home from './components/Home';
import Footer from './components/layout/Footer';
import About from './components/About';
import WhatsNew from './components/WhatsNew';
import UsageGuide from './components/UsageGuide';
import DeveloperAPI from './components/DeveloperAPI';
import SearchIndex from './components/SearchIndex';
import UIEval from './components/eval/UIEval';
import ChatPage from './components/chat/ChatPage';
import { getStoredAnswerFormat, setStoredAnswerFormat, CHAT_SESSION_STORAGE_KEY } from './config/chatConfig';
import StatsStrip from './components/chat/StatsStrip';
import { Spinner, ChevronUpIcon, ChevronDownIcon, ExpandIcon } from './components/SharedComponents';
import ExportPdfModal from './components/ExportPdfModal';
import { AlertTriangle, Mail, Home as HomeIcon, PenLine, SendHorizontal } from 'lucide-react';
import { Modal, InputActionBar, PageHeader } from './components/ui';

// Import API service
import { api } from './services/api';
import { getRandomSuggestedQueriesByLanguage } from './utils/suggestedQueries';
import { useAnyOverlayOpen } from './hooks/useOverlayRegistry';

// --- TIPS MODAL COMPONENT ---
const TipsModal = ({ onClose }) => {
    return (
        <Modal open onClose={onClose} title="Tips to write good queries" size="md">
            <ul className="space-y-4 text-ink">
                <li className="flex items-start">
                    <span className="text-brand font-bold mr-3">1.</span>
                    <span>Write in Hindi for the most accurate results.</span>
                </li>
                <li className="flex items-start">
                    <span className="text-brand font-bold mr-3">2.</span>
                    <span>For questions or specific phrases, end with punctuation like a question mark (?) or a Purn Viram (।).</span>
                </li>
                <li className="flex items-start">
                    <span className="text-brand font-bold mr-3">3.</span>
                    <span>If writing in English, avoid mixing in Hindi words written in the English alphabet (Hinglish).</span>
                </li>
            </ul>
            <div className="mt-6">
                <h3 className="text-lg font-semibold text-ink mb-3">Examples:</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <p className="font-semibold mb-2 text-ink">✅ Right</p>
                        <ul className="space-y-2">
                            <li className="badge-success rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"कुन्दकुन्दाचार्य विदेह"</li>
                            <li className="badge-success rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"शुद्धभाव अधिकार"</li>
                            <li className="badge-success rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"सम्यक् एकांत"</li>
                            <li className="badge-success rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"दृष्टि का विषय क्या है?"</li>
                            <li className="badge-success rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"कुन्दकुन्दाचार्य विदेह क्षेत्र कब गए थे?"</li>
                            <li className="badge-success rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"Where does Seemandhar God reside?"</li>
                        </ul>
                    </div>
                    <div>
                        <p className="font-semibold mb-2 text-ink">❌ Wrong</p>
                        <ul className="space-y-2">
                            <li className="badge-danger rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"सम्यक् एकांत क्या है"</li>
                            <li className="badge-danger rounded-md p-2 block" style={{ fontSize: 'inherit', fontWeight: 'normal' }}>"Kundkund Acharya kaun hai?"</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Link to Typing Guide */}
            <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div
                    className="rounded-lg p-4"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, var(--color-surface))', border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)' }}
                >
                    <div className="flex items-start">
                        <PenLine size={18} className="mt-0.5 mr-3 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
                        <div>
                            <h4 className="font-semibold mb-1" style={{ color: 'var(--color-warning)' }}>Need help typing in Hindi/Gujarati?</h4>
                            <p className="text-sm mb-3" style={{ color: 'var(--color-warning)' }}>
                                Learn how to set up Hindi and Gujarati typing on your device for better search results.
                            </p>
                            <button
                                onClick={() => {
                                    onClose();
                                    window.location.href = '/usage-guide#typing-guide';
                                }}
                                className="btn text-sm py-2 px-4"
                                style={{ backgroundColor: 'var(--color-warning)', color: '#fff' }}
                            >
                                View Typing Setup Guide
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
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
        if (path === '/chat') return 'chat';
        if (path === '/aagam-khoj') return 'aagam-khoj';
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
        } else if (path === '/chat') {
            setCurrentPageState('chat');
        } else if (path === '/aagam-khoj') {
            setCurrentPageState('aagam-khoj');
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
        
        // Reset search state when navigating to Aagam Khoj
        if (page === 'aagam-khoj') {
            resetSearchState();
        }

        const routes = {
            'home': '/',
            'about': '/about',
            'feedback': '/feedback',
            'whats-new': '/whats-new',
            'usage-guide': '/usage-guide',
            'search-index': '/search-index',
            'eval': '/eval',
            'aagam-khoj': '/aagam-khoj',
            'chat': '/chat'
        };
        navigate(routes[page] || '/');
    };
    const [query, setQuery] = useState('');
    const [activeFilters, setActiveFilters] = useState([]);
    const [contentTypes, setContentTypes] = useState({ pravachans: true, granths: true, books: false });
    const [debugMode, setDebugMode] = useState(false);
    const [appName, setAppName] = useState('swalakshya');
    const [activeCategories, setActiveCategories] = useState(['Pravachan', 'Granth']);
    const [language, setLanguage] = useState('hindi');
    const [textSearch, setTextSearch] = useState(false);
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
    const resultsPanelRef = useRef(null);
    const [loadingCategories, setLoadingCategories] = useState(new Set());
    const [suggestedQueries, setSuggestedQueries] = useState(() => getRandomSuggestedQueriesByLanguage(language, 5));
    const refreshSuggestedQueries = useCallback(() => {
        setSuggestedQueries(getRandomSuggestedQueriesByLanguage(language, 5));
    }, [language]);
    useEffect(() => { refreshSuggestedQueries(); }, [language]); // eslint-disable-line react-hooks/exhaustive-deps
    const [compact, setCompact] = useState(() => localStorage.getItem('resultDensity') === 'compact');
    const toggleCompact = () => setCompact(v => { const next = !v; localStorage.setItem('resultDensity', next ? 'compact' : 'comfortable'); return next; });
    const [activeTab, setActiveTab] = useState('pravachan');
    const [pravachanPage, setPravachanPage] = useState(1);
    const [granthPage, setGranthPage] = useState(1);
    const [booksPage, setBooksPage] = useState(1);
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
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportCategory, setExportCategory] = useState(null);
    const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
    // True while any modal/filter-sheet/drawer in the app is open (see useOverlayRegistry) —
    // used to hide the mobile Home/Feedback FABs below so they don't collide with it.
    const anyOverlayOpen = useAnyOverlayOpen();
    const PAGE_SIZE = 20;
    const [llmAvailable, setLlmAvailable] = useState(false);
    // Set by handleHomeChatSubmit (Home page's "ask AI" card) and consumed once by
    // ChatPage on mount to auto-send the first question — see ChatPage's
    // pendingChatQuestion effect.
    const [pendingChatQuestion, setPendingChatQuestion] = useState(null);
    const chatPageRef = useRef(null);
    const [answerFormat, setAnswerFormat] = useState(() => getStoredAnswerFormat());

    // Changing answer type ends the active chat session — its already-rendered
    // messages assume one format (structured's inline blockquote citations
    // aren't compatible with summary's (@@_N) badge parser, or vice versa), so
    // there's no way to keep them around correctly once the setting changes.
    // Clears the persisted session unconditionally (not just via ChatPage's own
    // ref) since Settings can be opened from any page, including ones where
    // ChatPage isn't mounted to clear it itself.
    const handleSaveAnswerFormat = (newFormat) => {
        setStoredAnswerFormat(newFormat);
        setAnswerFormat(newFormat);
        chatPageRef.current?.endChat();
        try { localStorage.removeItem(CHAT_SESSION_STORAGE_KEY); } catch {}
    };

    useEffect(() => {
        api.checkLlmHealth().then(setLlmAvailable);
    }, []);

    // Keep activeTab pointed at a category that actually has (or is loading) results,
    // e.g. when a content-type filter narrows results down to just Granth.
    useEffect(() => {
        if (!searchData || activeTab === 'similar') return;
        const counts = {
            pravachan: searchData.pravachan_results?.total_hits || 0,
            granth: searchData.granth_results?.total_hits || 0,
            books: searchData.books_results?.total_hits || 0,
        };
        const categoryLabel = { pravachan: 'Pravachan', granth: 'Granth', books: 'Books' };
        const isAvailable = (tab) => counts[tab] > 0 || loadingCategories.has(categoryLabel[tab]);
        if (isAvailable(activeTab)) return;
        const firstAvailable = ['pravachan', 'granth', 'books'].find(isAvailable);
        if (firstAvailable) setActiveTab(firstAvailable);
    }, [searchData, loadingCategories, activeTab]);

    // Mobile only: a search leaves the user looking at wherever they were
    // scrolled (often still the search bar) while the results panel renders
    // further down, off-screen — so it looks like nothing happened until they
    // manually scroll. Scrolling on isLoading going true (not on searchData
    // arriving) means they see the loading state itself, not just the
    // eventual results, which is the actual "something is happening" signal.
    // Mirrors ChatPage's identical fix for the same class of problem there.
    useEffect(() => {
        if (!isLoading) return;
        if (window.innerWidth >= 768) return; // matches Tailwind's md breakpoint used elsewhere
        const el = resultsPanelRef.current;
        if (!el) return;
        const NAV_HEIGHT = 64; // h-16, same sticky TopBar this app uses everywhere else
        const PADDING = 12;
        const top = el.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT - PADDING;
        window.scrollTo({ top, behavior: 'smooth' });
    }, [isLoading]);


    useEffect(() => {
        if (currentPage === 'home') {
            document.title = 'Swa Lakshya (स्व-लक्ष्य)';
            return;
        }
        const overrides = {
            'chat':         'Swalakshya AI',
            'search-index': 'Content',
            'usage-guide':  'Usage Guide',
            'whats-new':    "What's New",
            'developer':    'Developer APIs',
        };
        const label = overrides[currentPage] ||
            currentPage.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        document.title = `Swalakshya · ${label}`;
    }, [currentPage]);

    useEffect(() => {
        api.getAppConfig().then(cfg => {
            setAppName(cfg.app_name || 'swalakshya');
            setDebugMode(cfg.debug_mode);
            setActiveCategories(cfg.active_categories);
            if (cfg.active_categories.includes('Books')) {
                setContentTypes(prev => ({ ...prev, books: true }));
            }
        });
    }, []);

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

    // Auto-disable any category that has no filter of its own when at least one OTHER
    // category has been narrowed — e.g. picking a Pravachan series shouldn't also pull
    // in unrelated, unfiltered Granth/Books results. All three stay on when either
    // several are filtered together (a deliberate mix) or none is (the default
    // browse-everything state). This is a pure derivation (not stored in `contentTypes`
    // state) so it can't trigger the "clear filters when contentTypes changes" effect
    // below and wipe what was just set.
    const effectiveContentTypes = useMemo(() => {
        // "Name" is shared between the Granth and Books filters (both are valid
        // per-category on the backend), so each pick must be checked against its own
        // category's actual name list, never just the filter key.
        const granthNames = allMetadata?.Granth?.[language]?.Name || [];
        const booksNames = allMetadata?.Books?.[language]?.Name || [];
        const hasPravachanFilter = activeFilters.some(f => f.key === '_pravachan_groups');
        const hasGranthFilter = activeFilters.some(f => f.key === 'Name' && granthNames.includes(f.value));
        const hasBooksFilter = activeFilters.some(f => f.key === 'Name' && booksNames.includes(f.value));
        const hasAnyCategoryFilter = hasPravachanFilter || hasGranthFilter || hasBooksFilter;
        return {
            ...contentTypes,
            pravachans: contentTypes.pravachans && (hasPravachanFilter || !hasAnyCategoryFilter),
            granths: contentTypes.granths && (hasGranthFilter || !hasAnyCategoryFilter),
            books: contentTypes.books && (hasBooksFilter || !hasAnyCategoryFilter),
        };
    }, [activeFilters, contentTypes, allMetadata, language]);

    // Single source of truth for building search payload
    const buildSearchPayload = useCallback((pravachanPage = 1, granthPage = 1) => {
        return {
            query,
            text_search: textSearch,
            exact_match: exactMatch,
            exclude_words: excludeWords.split(',').map(word => word.trim()).filter(word => word.length > 0),
            categories: activeFilters.reduce((acc, f) => ({ ...acc, [f.key]: [...(acc[f.key] || []), f.value] }), {}),
            language: language,
            search_types: {
                "Pravachan": {
                    "enabled": effectiveContentTypes.pravachans,
                    "page_size": PAGE_SIZE,
                    "page_number": pravachanPage
                },
                "Granth": {
                    "enabled": effectiveContentTypes.granths,
                    "page_size": PAGE_SIZE,
                    "page_number": granthPage
                },
                "Books": {
                    "enabled": effectiveContentTypes.books,
                    "page_size": PAGE_SIZE,
                    "page_number": booksPage
                }
            },
            enable_reranking: searchType === 'relevance',
            query_id: Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join(''),
            ...(startYear && { start_year: startYear }),
            ...(endYear && { end_year: endYear })
        };
    }, [query, activeFilters, contentTypes, effectiveContentTypes, language, textSearch, exactMatch, excludeWords, searchType, startYear, endYear, booksPage]);

    // Params for the "Export PDF" modal: the same query/filters as the active
    // search (no per-category page/enabled config -- /api/export-pdf always
    // searches its one requested category from page 1).
    const buildExportParams = useCallback((category) => ({
        query,
        text_search: textSearch,
        exact_match: exactMatch,
        exclude_words: excludeWords.split(',').map(word => word.trim()).filter(word => word.length > 0),
        categories: activeFilters.reduce((acc, f) => ({ ...acc, [f.key]: [...(acc[f.key] || []), f.value] }), {}),
        language,
        enable_reranking: searchType === 'relevance',
        ...(startYear && { start_year: startYear }),
        ...(endYear && { end_year: endYear }),
        category,
    }), [query, activeFilters, language, textSearch, exactMatch, excludeWords, searchType, startYear, endYear]);

    const handleSearch = useCallback(async (page = 1) => {
        if (!query.trim()) {
            alert("Please enter a search query.");
            return;
        }
        setIsLoading(true);
        setSearchData(null);
        setPravachanPage(page);
        setBooksPage(1);
        setSimilarDocumentsData(null);
        setSourceDocForSimilarity(null);

        const requestPayload = buildSearchPayload(1, 1);
        setLoadingCategories(new Set(activeCategories));
        setActiveTab(activeCategories[0]?.toLowerCase() || 'pravachan');
        const data = await api.search(requestPayload, (category, partialData) => {
            setSearchData({ ...partialData });
            setLoadingCategories(prev => { const n = new Set(prev); n.delete(category); return n; });
        });
        setSearchData(data);
        setLoadingCategories(new Set());
        setIsLoading(false);
    }, [activeCategories, buildSearchPayload, query]);


    // Home page's Swalakshya Khoj card: setQuery + handleSearch race, since
    // handleSearch reads `query` via closure — this waits for the query state
    // (and handleSearch's own recreated closure over it) to actually land
    // before firing the search, rather than calling handleSearch synchronously
    // with what would still be the pre-update query.
    const [pendingHomeSearch, setPendingHomeSearch] = useState(false);
    useEffect(() => {
        if (!pendingHomeSearch) return;
        setPendingHomeSearch(false);
        handleSearch(1);
    }, [pendingHomeSearch, handleSearch]);

    const handleHomeKhojSubmit = (text) => {
        setCurrentPage('aagam-khoj'); // resets search state, including query — must run first
        setQuery(text);
        setPendingHomeSearch(true);
    };

    // Navigates to chat and hands the typed question to ChatPage, which auto-sends
    // it once mounted (see pendingChatQuestion prop / ChatPage's mount effect) —
    // ChatPage owns handleChatStart now, so this can't call it directly.
    const handleHomeChatSubmit = (text) => {
        setCurrentPage('chat');
        setPendingChatQuestion(text);
    };

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

    const handleBooksSearch = useCallback(async (page = 1) => {
        if (!query.trim()) {
            return;
        }
        setIsLoading(true);
        setBooksPage(page);

        const requestPayload = buildSearchPayload(1, 1);
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
        } else if (searchData?.books_results?.total_hits > 0) {
            setActiveTab('books');
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

        setSearchData(null);
        setLoadingCategories(new Set(activeCategories));
        setActiveTab(activeCategories[0]?.toLowerCase() || 'pravachan');
        api.search(requestPayload, (category, partialData) => {
            setSearchData({ ...partialData });
            setLoadingCategories(prev => { const n = new Set(prev); n.delete(category); return n; });
        }).then(data => {
            setSearchData(data);
            setLoadingCategories(new Set());
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
            case 'books':
                handleBooksSearch(page);
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

    const showSearchInterface = currentPage === 'aagam-khoj';

    return (
        <div style={{ backgroundColor: 'var(--color-bg)', '--bg-card': 'var(--color-surface)', '--bg-surface': 'var(--color-bg)' }} className="text-ink min-h-screen font-sans grid grid-cols-[auto_1fr] grid-rows-[auto_1fr]">
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
            
            {debugMode && (
                <div className="fixed bottom-4 left-4 z-50 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg select-none" style={{ backgroundColor: 'var(--color-danger)' }} title="Debug mode is on — all categories visible. Never enabled in production.">
                    DEBUG
                </div>
            )}
            <TopBar
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                onOpenMobileSidebar={() => setSidebarMobileOpen(true)}
            />

            <Sidebar
                chatMode={currentPage === 'chat'}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                onNewChat={() => chatPageRef.current?.startNewChat()}
                mobileOpen={sidebarMobileOpen}
                onCloseMobile={() => setSidebarMobileOpen(false)}
                answerFormat={answerFormat}
                onSaveAnswerFormat={handleSaveAnswerFormat}
            />

            <div className="flex flex-col min-w-0 col-start-2 row-start-2">
                <div className="p-4 md:p-5">
                <div className={`max-w-[1080px] mx-auto ${currentPage !== 'eval' ? 'pt-14' : ''}`}>

                    {currentPage === 'chat' && !llmAvailable && (
                        <main>
                            <div className="text-center py-16">
                                <p className="text-ink-muted text-lg">AI Service is unavailable right now.</p>
                            </div>
                        </main>
                    )}

                    {currentPage === 'chat' && llmAvailable && (
                        <main>
                            <ChatPage
                                ref={chatPageRef}
                                answerFormat={answerFormat}
                                language={language}
                                appName={appName}
                                activeCategories={activeCategories}
                                debugMode={debugMode}
                                activeFilters={activeFilters}
                                startYear={startYear}
                                endYear={endYear}
                                query={query}
                                setQuery={setQuery}
                                pendingChatQuestion={pendingChatQuestion}
                                onPendingChatQuestionConsumed={() => setPendingChatQuestion(null)}
                                onNavigateFeedback={() => setCurrentPage('feedback')}
                            />
                        </main>
                    )}

                    {showSearchInterface && (
                        <main>
                            <PageHeader
                                        variant="hero"
                                        title="Swalakshya Khoj"
                                        subtitle="Explore and search across the Jain literature comprising authentic Digambar Jain Scriptures, Pravachans of Pujya Gurudevshri Kanji Swami, and literature by contemporary Jain scholars."
                                    />
                                    <div className="mb-3">
                                        <StatsStrip />
                                    </div>
                                    <div className="card p-3 shadow-sm mb-3">
                                        <InputActionBar
                                            action={
                                                <button
                                                    onClick={() => handleSearch(1)}
                                                    disabled={isLoading || query.trim().length === 0}
                                                    className="btn btn-primary h-10 w-10 rounded-full p-0 shrink-0"
                                                    aria-label="Search"
                                                >
                                                    {isLoading ? <Spinner /> : <SendHorizontal size={18} strokeWidth={2.5} />}
                                                </button>
                                            }
                                        >
                                            <SearchBar
                                                query={query}
                                                setQuery={setQuery}
                                                onSearch={() => handleSearch(1)}
                                                language={language}
                                                bare
                                            />
                                        </InputActionBar>
                                        <div className="flex items-center justify-between mt-3">
                                            <button
                                                onClick={() => setShowFilters(!showFilters)}
                                                className="flex items-center text-brand font-semibold hover:text-brand-hover text-sm whitespace-nowrap"
                                            >
                                                {showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
                                                {showFilters ? 'Hide Filters' : 'Show Filters'}
                                            </button>
                                            <button
                                                onClick={() => setShowTipsModal(true)}
                                                className="flex items-center text-brand font-semibold hover:text-brand-hover text-sm whitespace-nowrap"
                                                aria-label="Tips for writing good queries"
                                            >
                                                <ExpandIcon />
                                                <span className="hidden sm:inline">Tips for writing good queries</span>
                                                <span className="sm:hidden">Tips</span>
                                            </button>
                                        </div>
                                        {showFilters && (
                                            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                                                <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_1fr] gap-5">
                                                    <SearchFilters
                                                        allMetadata={allMetadata}
                                                        activeFilters={activeFilters}
                                                        onAddFilter={addFilter}
                                                        onRemoveFilter={removeFilter}
                                                        contentTypes={effectiveContentTypes}
                                                        setContentTypes={setContentTypes}
                                                        language={language}
                                                        startYear={startYear}
                                                        setStartYear={setStartYear}
                                                        endYear={endYear}
                                                        setEndYear={setEndYear}
                                                        activeCategories={activeCategories}
                                                    />
                                                    <SearchOptions language={language} setLanguage={setLanguage} />
                                                    <AdvancedSearch
                                                        textSearch={textSearch}
                                                        setTextSearch={setTextSearch}
                                                        exactMatch={exactMatch}
                                                        setExactMatch={setExactMatch}
                                                        excludeWords={excludeWords}
                                                        setExcludeWords={setExcludeWords}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {(isLoading || searchData || similarDocumentsData) && (
                                        <div className="mt-4">
                                            <SuggestionsCard
                                                suggestions={searchData?.suggestions}
                                                originalQuery={query}
                                                onSuggestionClick={handleSuggestionClick}
                                                hasResults={loadingCategories.size > 0 || (searchData?.pravachan_results?.total_hits || 0) > 0 || (searchData?.granth_results?.total_hits || 0) > 0 || (searchData?.books_results?.total_hits || 0) > 0}
                                            />
                                            {searchData && query && (
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className="text-sm text-ink">
                                                        <span className="font-semibold text-ink">
                                                            {((searchData.pravachan_results?.total_hits || 0) + (searchData.granth_results?.total_hits || 0) + (searchData.books_results?.total_hits || 0)).toLocaleString()}
                                                        </span> results for <span className="font-semibold text-ink">"{query}"</span>
                                                    </p>
                                                    <button onClick={toggleCompact}
                                                        className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 transition-colors font-medium"
                                                        title={compact ? 'Switch to comfortable view' : 'Switch to compact view'}>
                                                        {compact ? (
                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><rect y="2" width="16" height="2" rx="1"/><rect y="7" width="16" height="2" rx="1"/><rect y="12" width="16" height="2" rx="1"/></svg>
                                                        ) : (
                                                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><rect y="1" width="16" height="3" rx="1"/><rect y="6" width="16" height="3" rx="1"/><rect y="11" width="16" height="3" rx="1"/></svg>
                                                        )}
                                                        {compact ? 'Comfortable' : 'Compact'}
                                                    </button>
                                                </div>
                                            )}
                                            <div
                                                className="flex items-start gap-2.5 px-3.5 py-2.5 mb-3 rounded text-xs leading-relaxed"
                                                style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-surface))', border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)', color: 'var(--color-warning)' }}
                                            >
                                                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                                <span><strong>Note:</strong> Text from Pravachans and Granths is extracted via OCR and results are ranked by AI — both may contain errors. For <strong>accurate reference</strong>, please use the <strong>original PDFs</strong> linked alongside each result.</span>
                                            </div>
                                            <div className="card overflow-hidden" ref={resultsPanelRef}>
                                                <Tabs activeTab={activeTab} setActiveTab={setActiveTab} searchData={searchData}
                                                    similarDocumentsData={similarDocumentsData} onClearSimilar={handleClearSimilar}
                                                    loadingCategories={loadingCategories} activeCategories={activeCategories}
                                                    onExportClick={(category) => { setExportCategory(category); setShowExportModal(true); }} />
                                                {showExportModal && exportCategory && (
                                                    <ExportPdfModal
                                                        exportParams={buildExportParams(exportCategory)}
                                                        onClose={() => setShowExportModal(false)}
                                                    />
                                                )}
                                                {activeTab === 'pravachan' && loadingCategories.has('Pravachan') && <SkeletonResultsList />}
                                                {activeTab === 'pravachan' && searchData?.pravachan_results?.results.length > 0 && (
                                                    <ResultsList results={searchData.pravachan_results.results} totalResults={searchData.pravachan_results.total_hits}
                                                        pageSize={PAGE_SIZE} currentPage={pravachanPage} onPageChange={handlePageChange}
                                                        resultType="pravachan" onFindSimilar={handleFindSimilar} onExpand={handleExpand}
                                                        searchType={searchType} query={query} currentFilters={activeFilters} language={language} compact={compact} />
                                                )}
                                                {activeTab === 'granth' && loadingCategories.has('Granth') && <SkeletonResultsList />}
                                                {activeTab === 'granth' && searchData?.granth_results?.results.length > 0 && (
                                                    <ResultsList results={searchData.granth_results.results} totalResults={searchData.granth_results.total_hits}
                                                        pageSize={PAGE_SIZE} currentPage={granthPage} onPageChange={handlePageChange}
                                                        resultType="granth" onFindSimilar={handleFindSimilar} onExpand={handleExpand}
                                                        onExpandGranth={handleExpandGranth} searchType={searchType} query={query}
                                                        currentFilters={activeFilters} language={language} compact={compact} />
                                                )}
                                                {activeTab === 'books' && loadingCategories.has('Books') && <SkeletonResultsList />}
                                                {activeTab === 'books' && searchData?.books_results?.results.length > 0 && (
                                                    <ResultsList results={searchData.books_results.results} totalResults={searchData.books_results.total_hits}
                                                        pageSize={PAGE_SIZE} currentPage={booksPage} onPageChange={handlePageChange}
                                                        resultType="books" onFindSimilar={handleFindSimilar} onExpand={handleExpand}
                                                        searchType={searchType} query={query} currentFilters={activeFilters} language={language} compact={compact} />
                                                )}
                                                {activeTab === 'similar' && (
                                                    <div className="bg-white p-3 md:p-4">
                                                        <SimilarSourceInfoCard sourceDoc={sourceDocForSimilarity} />
                                                        {similarDocumentsData?.results.length > 0 ? (
                                                            <ResultsList results={paginatedSimilarResults} totalResults={similarDocumentsData.total_results}
                                                                pageSize={PAGE_SIZE} currentPage={similarDocsPage} onPageChange={handlePageChange}
                                                                resultType="similar" onFindSimilar={handleFindSimilar} onExpand={handleExpand}
                                                                searchType={searchType} query={query} currentFilters={activeFilters} compact={compact} language={language} />
                                                        ) : (
                                                            <div className="text-center py-8 text-sm text-ink-muted">No similar documents found.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {!isLoading && !searchData && !similarDocumentsData && (
                                        <div className="mt-5">
                                            <p className="text-xs text-ink-muted uppercase tracking-wider mb-2.5 font-medium">Try searching for</p>
                                            <div className="flex flex-wrap gap-2">
                                                {suggestedQueries.map(term => (
                                                    <button key={term} onClick={() => handleSuggestionClick(term)}
                                                        className="chip-quiet px-3 py-1 text-sm rounded transition-colors">
                                                        {term}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                        </main>
                    )}

                    {currentPage === 'feedback' && (
                        <main>
                            <GoogleReCaptchaProvider
                                reCaptchaKey={process.env.REACT_APP_RECAPTCHA_SITE_KEY || "__REACT_APP_RECAPTCHA_SITE_KEY__"}
                            >
                                <FeedbackForm onReturnToAagamKhoj={() => setCurrentPage('aagam-khoj')} />
                            </GoogleReCaptchaProvider>
                        </main>
                    )}

                    {currentPage === 'home' && (
                        <main>
                            <Home
                                setCurrentPage={setCurrentPage}
                                onKhojSubmit={handleHomeKhojSubmit}
                                onChatSubmit={handleHomeChatSubmit}
                            />
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

                    {currentPage === 'developer' && (
                        <main>
                            <DeveloperAPI />
                        </main>
                    )}

                    {currentPage === 'eval' && (
                        <main>
                            <UIEval />
                        </main>
                    )}
                </div>
                </div>
                {currentPage !== 'eval' && <Footer />}
            </div>

            {/* Mobile Navigation Buttons - Only visible on mobile, hidden while any overlay
                (filter sheet, modal, PDF viewer, drawer, ...) is open so they don't collide
                with it — see useAnyOverlayOpen / useOverlayBehavior for the shared mechanism. */}
            {currentPage !== 'feedback' && !anyOverlayOpen && (
                <button
                    onClick={() => setCurrentPage('feedback')}
                    className="btn btn-primary md:hidden fixed bottom-6 right-6 p-3 rounded-full shadow-lg z-50"
                    aria-label="Feedback"
                >
                    <Mail size={20} />
                </button>
            )}

            {currentPage !== 'home' && !anyOverlayOpen && (
                <button
                    onClick={() => setCurrentPage('home')}
                    className="btn btn-secondary md:hidden fixed bottom-6 left-6 p-3 rounded-full shadow-lg z-50"
                    aria-label="Home"
                >
                    <HomeIcon size={20} />
                </button>
            )}

        </div>
    );
};

// Admin route wrapper — persists session token in localStorage (survives tab close, expires after 1 day)
function AdminRoute() {
    React.useEffect(() => { document.title = 'Swalakshya · Admin'; }, []);
    const [token, setToken] = React.useState(() => localStorage.getItem('adminToken'));
    const [llmToken, setLlmToken] = React.useState(() => localStorage.getItem('llmAdminToken'));
    const handleAuth = (t, lt) => {
        localStorage.setItem('adminToken', t); setToken(t);
        if (lt) { localStorage.setItem('llmAdminToken', lt); setLlmToken(lt); }
    };
    const handleLogout = () => {
        localStorage.removeItem('adminToken'); localStorage.removeItem('llmAdminToken');
        setToken(null); setLlmToken(null);
    };
    if (!token) return <AdminLoginPage onAuth={handleAuth} />;
    return <AdminPageComponent token={token} llmToken={llmToken} onLogout={handleLogout} />;
}

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
                <Route path="/developer" element={<AppContent />} />
                <Route path="/chat" element={<AppContent />} />
                <Route path="/aagam-khoj" element={<AppContent />} />
                <Route path="/admin" element={<AdminRoute />} />
            </Routes>
        </Router>
    );
}
