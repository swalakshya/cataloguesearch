import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';

// Import components
import { Navigation, Header } from './components/Navigation';
import AdminLoginPage from './components/admin/AdminLogin';
import AdminPageComponent from './components/admin/AdminPage';
import { SearchBar, MetadataFilters, AdvancedSearch, SearchOptions } from './components/SearchInterface';
import { ResultsList, SuggestionsCard, Tabs, SimilarSourceInfoCard, SkeletonResultsList } from './components/SearchResults';
import { ExpandModal, GranthVerseModal, GranthProseModal, WelcomeModal } from './components/Modals';
import { FeedbackForm } from './components/Feedback';
import About from './components/About';
import WhatsNew from './components/WhatsNew';
import UsageGuide from './components/UsageGuide';
import DeveloperAPI from './components/DeveloperAPI';
import SearchIndex from './components/SearchIndex';
import UIEval from './components/eval/UIEval';
import SearchableContentWidget from './components/SearchableContentWidget';
import { Spinner, ChevronUpIcon, ChevronDownIcon, ExpandIcon, PdfIcon } from './components/SharedComponents';

// Import API service
import { api } from './services/api';
import { getRandomSuggestedQueriesByLanguage } from './utils/suggestedQueries';
import { copyToClipboard } from './utils/shareUtils';

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


// --- COPY ANSWER BUTTON ---
const CopyAnswerButton = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const success = await copyToClipboard(text);
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded px-2 py-1 transition-colors"
            title="Copy answer"
        >
            {copied ? (
                <>
                    <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-green-600">Copied</span>
                </>
            ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="8" y="8" width="12" height="14" rx="2" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v10a2 2 0 002 2h2" />
                </svg>
            )}
        </button>
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
        if (path === '/aibot') return 'aibot';
        return 'home'; // Default to 'home' for root path
    });
    
    // Update state when URL changes (browser navigation)
    useEffect(() => {
        const path = location.pathname;
        setHomeMode(path === '/aibot' ? 'chat' : 'search');
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
        } else if (path === '/aibot') {
            setCurrentPageState('aibot');
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
        setLlmAnswer(null);
        setLlmReferences([]);
        setLlmCitations([]);
        setLlmError(null);
        setLlmLoading(false);
        setChatMessages([]);
        setChatInput('');
        setChatInputVisible(false);
        resetTypingState();
        clearPersistedChatSession();
        setHomeMode('search');
        if (chatSessionId) {
            api.closeChatSession(chatSessionId).catch(() => null);
            setChatSessionId(null);
        }
    };

    const currentPage = currentPageState;
    const setCurrentPage = (page) => {
        setCurrentPageState(page);
        
        // Reset search state when navigating to Home
        if (page === 'home') {
            resetSearchState();
        } else if (chatSessionId) {
            api.closeChatSession(chatSessionId).catch(() => null);
            setChatSessionId(null);
            setChatMessages([]);
            setChatInput('');
            setChatInputVisible(false);
            resetTypingState();
            clearPersistedChatSession();
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
    const [contentTypes, setContentTypes] = useState({ pravachans: true, granths: true, books: false });
    const [debugMode, setDebugMode] = useState(false);
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
    const [loadingCategories, setLoadingCategories] = useState(new Set());
    const suggestedQueries = useMemo(() => getRandomSuggestedQueriesByLanguage(language, 5), [language]);
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
    const [llmAnswer, setLlmAnswer] = useState(null);
    const [llmReferences, setLlmReferences] = useState([]);
    const [llmCitations, setLlmCitations] = useState([]);
    const [llmError, setLlmError] = useState(null);
    const [llmLoading, setLlmLoading] = useState(false);
    const [chatSessionId, setChatSessionId] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatInputVisible, setChatInputVisible] = useState(false);
    const PAGE_SIZE = 20;
    const llmProvider = (process.env.REACT_APP_LLM_PROVIDER || '').trim();
    const [llmAvailable, setLlmAvailable] = useState(false);
    const [homeMode, setHomeMode] = useState(() => location.pathname === '/aibot' ? 'chat' : 'search');
    const [displayedTexts, setDisplayedTexts] = useState({});
    const typingIntervalsRef = useRef({});
    const messagesEndRef = useRef(null);
    const isChatMode = homeMode === 'chat';
    const chatEnabled = isChatMode;

    const resetTypingState = useCallback(() => {
        Object.values(typingIntervalsRef.current).forEach(clearInterval);
        typingIntervalsRef.current = {};
        setDisplayedTexts({});
    }, []);

    const clearPersistedChatSession = useCallback(() => {
        try {
            localStorage.removeItem('llmChatSession');
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, []);

    useEffect(() => {
        api.checkLlmHealth().then(setLlmAvailable);
    }, []);

    // Typing effect: reveal each new assistant message character by character
    useEffect(() => {
        chatMessages.forEach((msg, idx) => {
            if (msg.role === 'assistant' && !msg.pending && msg.content &&
                displayedTexts[idx] === undefined && !typingIntervalsRef.current[idx]) {
                let charIdx = 0;
                const fullText = msg.content;
                typingIntervalsRef.current[idx] = setInterval(() => {
                    charIdx += 4;
                    if (charIdx >= fullText.length) {
                        charIdx = fullText.length;
                        clearInterval(typingIntervalsRef.current[idx]);
                        delete typingIntervalsRef.current[idx];
                    }
                    setDisplayedTexts(prev => ({ ...prev, [idx]: fullText.slice(0, charIdx) }));
                }, 16);
            }
        });
    }, [chatMessages]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-scroll to bottom when messages or typed text updates
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, displayedTexts]);

    useEffect(() => {
        if (currentPage === 'home') {
            document.title = 'Swa Lakshya (स्व-लक्ष्य)';
            return;
        }
        const overrides = {
            'aibot':        'AI Bot',
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

    useEffect(() => {
        if (!chatEnabled) return;
        try {
            const stored = localStorage.getItem('llmChatSession');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed?.sessionId) {
                    setChatSessionId(parsed.sessionId);
                    setChatMessages(parsed.messages || []);
                    setDisplayedTexts(
                        (parsed.messages || []).reduce((acc, msg, idx) => {
                            if (msg?.role === 'assistant' && msg?.content) {
                                acc[idx] = msg.content;
                            }
                            return acc;
                        }, {})
                    );
                }
            }
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, [chatEnabled]);

    useEffect(() => {
        if (!chatEnabled) return;
        try {
            if (chatSessionId) {
                localStorage.setItem(
                    'llmChatSession',
                    JSON.stringify({ sessionId: chatSessionId, messages: chatMessages })
                );
            } else {
                localStorage.removeItem('llmChatSession');
            }
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, [chatEnabled, chatSessionId, chatMessages]);

    const getChatSessionPayload = useCallback(() => {
        const languageCode = language === 'gujarati' ? 'gu' : 'hi';
        return {
            language: languageCode,
            ...(llmProvider ? { provider: llmProvider } : {})
        };
    }, [language, llmProvider]);

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
            text_search: textSearch,
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
                },
                "Books": {
                    "enabled": contentTypes.books,
                    "page_size": PAGE_SIZE,
                    "page_number": booksPage
                }
            },
            enable_reranking: searchType === 'relevance',
            query_id: Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join(''),
            ...(startYear && { start_year: startYear }),
            ...(endYear && { end_year: endYear })
        };
    }, [query, activeFilters, contentTypes, language, textSearch, exactMatch, excludeWords, searchType, startYear, endYear, booksPage]);

    function buildLlmFilters() {
        const filters = {};
        // In chat mode, use all active categories (driven by debugMode, not manual filter selection)
        const types = isChatMode
            ? [...activeCategories]
            : [
                ...(contentTypes.pravachans ? ['Pravachan'] : []),
                ...(contentTypes.granths ? ['Granth'] : []),
                ...(contentTypes.books ? ['Books'] : []),
              ];
        if (types.length) filters.content_type = types;

        if (startYear) filters.year_from = Number(startYear);
        if (endYear) filters.year_to = Number(endYear);

        activeFilters.forEach((filter) => {
            const key = String(filter.key || '').toLowerCase();
            const value = filter.value;
            if (!value) return;
            if (key.includes('granth')) {
                filters.granth = value;
            } else if (key.includes('anuyog')) {
                filters.anuyog = value;
            } else if (
                key.includes('author') ||
                key.includes('tikakaar') ||
                key.includes('teekakar') ||
                key.includes('bhasha vachanika') ||
                key.includes('contributor')
            ) {
                filters.contributor = value;
            }
        });

        return filters;
    }

    const handleSearch = useCallback(async (page = 1) => {
        if (!query.trim()) {
            alert("Please enter a search query.");
            return;
        }
        setIsLoading(true);
        setSearchData(null);
        setLlmAnswer(null);
        setLlmReferences([]);
        setLlmCitations([]);
        setLlmError(null);
        setChatMessages([]);
        setChatInput('');
        setChatInputVisible(false);
        resetTypingState();
        clearPersistedChatSession();
        if (chatSessionId) {
            api.closeChatSession(chatSessionId).catch(() => null);
            setChatSessionId(null);
        }
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
    }, [activeCategories, buildSearchPayload, chatSessionId, clearPersistedChatSession, query, resetTypingState]);

    async function handleChatSend(sessionId, message) {
        if (!message.trim()) {
            return;
        }
        setLlmLoading(true);
        setLlmError(null);
        setChatMessages(prev => [...prev, { role: 'user', content: message }, { role: 'assistant', pending: true }]);
        setChatInput('');
        setChatInputVisible(false);
        try {
            let data;
            try {
                data = await api.sendChatMessage(sessionId, {
                    role: 'user',
                    content: message,
                    filters: buildLlmFilters()
                });
            } catch (error) {
                if (error?.detail !== 'session_not_found') {
                    throw error;
                }

                clearPersistedChatSession();
                flushSync(() => {
                    resetTypingState();
                    setChatSessionId(null);
                    setChatMessages([{ role: 'user', content: message }, { role: 'assistant', pending: true }]);
                });

                const freshSession = await api.createChatSession(getChatSessionPayload());
                setChatSessionId(freshSession.session_id);
                data = await api.sendChatMessage(freshSession.session_id, {
                    role: 'user',
                    content: message,
                    filters: buildLlmFilters()
                });
            }
            setChatMessages(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(item => item.role === 'assistant' && item.pending);
                if (idx !== -1) {
                    updated[idx] = {
                        role: 'assistant',
                        content: data.answer || '',
                        follow_up_questions: data.follow_up_questions || [],
                        references: data.references || [],
                        citations: data.citations || []
                    };
                    return updated;
                }
                return [
                    ...updated,
                    {
                        role: 'assistant',
                        content: data.answer || '',
                        follow_up_questions: data.follow_up_questions || [],
                        references: data.references || [],
                        citations: data.citations || []
                    }
                ];
            });
        } catch (error) {
            if (error?.detail === 'session_not_found') {
                clearPersistedChatSession();
                setChatSessionId(null);
                setChatMessages([]);
                setLlmError('The previous chat session expired. Please send your question again.');
            } else {
                setLlmError('Could not continue chat. Please try again.');
                setChatMessages(prev => prev.filter(item => !(item.role === 'assistant' && item.pending)));
            }
        } finally {
            setLlmLoading(false);
        }
    }

    async function handleChatStart(firstQuestion) {
        setLlmLoading(true);
        setLlmError(null);
        setChatMessages([]);
        setChatInput('');
        setChatInputVisible(false);
        resetTypingState();
        clearPersistedChatSession();
        try {
            const session = await api.createChatSession(getChatSessionPayload());
            setChatSessionId(session.session_id);
            await handleChatSend(session.session_id, firstQuestion);
        } catch (error) {
            setLlmError('Could not start chat. Please try again.');
        } finally {
            setLlmLoading(false);
        }
    }

    async function handleAnswer() {
        if (!query.trim()) {
            alert("Please enter a search query.");
            return;
        }
        if (chatEnabled) {
            await handleChatStart(query);
            return;
        }
        setLlmLoading(true);
        setLlmError(null);
        setLlmAnswer(null);
        setLlmReferences([]);

        const languageCode = language === 'gujarati' ? 'gu' : 'hi';
        try {
            const sessionPayload = {
                language: languageCode,
                ...(llmProvider ? { provider: llmProvider } : {})
            };
            const session = await api.createChatSession(sessionPayload);
            const data = await api.sendChatMessage(session.session_id, {
                role: 'user',
                content: query,
                filters: buildLlmFilters()
            });
            setLlmAnswer(data.answer || '');
            setLlmReferences(data.references || []);
            setLlmCitations(data.citations || []);
            await api.closeChatSession(session.session_id).catch(() => null);
        } catch (error) {
            setLlmError('Could not generate answer. Please try again.');
        } finally {
            setLlmLoading(false);
        }
    }

    const handleEndChat = useCallback(async () => {
        if (chatSessionId) {
            await api.closeChatSession(chatSessionId).catch(() => null);
        }
        setChatSessionId(null);
        setChatMessages([]);
        setChatInput('');
        setChatInputVisible(false);
        setLlmError(null);
        resetTypingState();
        clearPersistedChatSession();
    }, [chatSessionId, clearPersistedChatSession, resetTypingState]);

    const handleNewChat = useCallback(async () => {
        await handleEndChat();
        setQuery('');
    }, [handleEndChat]);

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

    const showSearchInterface = currentPage === 'home' || (currentPage === 'aibot' && llmAvailable);

    const cleanAnswerText = (answerText) => {
        if (!answerText) return '';
        // Strip any leading asterisks around the References/संदर्भ keyword before matching
        const refIdx = answerText.search(/\n?\**\s*(?:References\b|संदर्भ)/i);
        const trimmed = refIdx >= 0 ? answerText.slice(0, refIdx) : answerText;
        return trimmed.trim();
    };

    const formatAnswerHtml = (answerText) => {
        if (!answerText) return '';
        let sanitizedAnswer = cleanAnswerText(answerText);

        // Mark detail-prompt phrases BEFORE any tokenization so the marker survives even if the
        // phrase gets wrapped in *bold* or _italic_ by the backend.
        // @@BREAK@@ contains no chars that any tokenization regex targets.
        sanitizedAnswer = sanitizedAnswer.replace(
            /(If you want I can answer this in detail|अगर आप चाहें तो मैं और विस्तार से उत्तर दे सकता)/g,
            '@@BREAK@@$1'
        );

        const headingParts = [];
        const boldParts = [];
        const italicParts = [];
        const citationParts = [];
        const codeParts = [];
        const quoteParts = [];
        const parenParts = [];

        // Step 1: Extract _italic_ FIRST — before any underscore-containing tokens are created,
        // so the token strings like __CODE_0__ don't get falsely matched by _([^_\n]+?)_
        sanitizedAnswer = sanitizedAnswer.replace(/_([^_\n]+?)_/g, (match, content) => {
            italicParts.push(content);
            return `__ITAL_${italicParts.length - 1}__`;
        });

        // Step 2: Extract ## / ### headings
        sanitizedAnswer = sanitizedAnswer.replace(/^#{2,3}\s*(.+)$/gm, (match, content) => {
            headingParts.push(content);
            return `__HEADING_BOLD_${headingParts.length - 1}__`;
        });

        // Step 3: Extract standalone *text* lines as bold headings (single asterisk, WhatsApp style)
        sanitizedAnswer = sanitizedAnswer.replace(/^\s*\*([^*\n]+?)\*\s*$/gm, (match, content) => {
            headingParts.push(content);
            return `__HEADING_BOLD_${headingParts.length - 1}__`;
        });

        // Step 4: Strip triple backticks — render content as plain text (no code styling)
        sanitizedAnswer = sanitizedAnswer.replace(/```([^`][\s\S]*?)```/g, (match, content) => content);

        // Step 5: Extract single backtick inline code (not preceded/followed by another backtick)
        sanitizedAnswer = sanitizedAnswer.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (match, content) => {
            codeParts.push(content);
            return `__CODE_${codeParts.length - 1}__`;
        });

        // Step 6: Extract > quote lines (WhatsApp-style citations); trailing (ref) becomes an italic subscript
        // Leading whitespace before > is stripped so indented quote lines still match
        sanitizedAnswer = sanitizedAnswer.replace(/^\s*>\s*(.+)$/gm, (match, content) => {
            const refMatch = content.match(/^([\s\S]+?)\s*(\([^)]+\))\s*$/);
            if (refMatch) {
                quoteParts.push(refMatch[1]);
                citationParts.push(refMatch[2]);
                return `__QUOT_${quoteParts.length - 1}__ __CITE_${citationParts.length - 1}__`;
            }
            quoteParts.push(content);
            return `__QUOT_${quoteParts.length - 1}__`;
        });

        // Step 7: Extract inline *bold* (single asterisk, WhatsApp style)
        let text = sanitizedAnswer.replace(/\*([^*\n]+?)\*/g, (match, content) => {
            boldParts.push(content);
            return `__BOLD_${boldParts.length - 1}__`;
        });

        // Step 8: Extract curly-quoted text as italic
        text = text.replace(/”([^”]+)”/g, (match, content) => {
            italicParts.push(content);
            return `__ITAL_${italicParts.length - 1}__`;
        });
        text = text.replace(/”([^”]+)”/g, (match, content) => {
            italicParts.push(content);
            return `__ITAL_${italicParts.length - 1}__`;
        });

        // Step 9: Extract parenthesised text for smaller rendering.
        // Runs after all other tokenizations so (ref) from citations is already gone (__CITE__ token).
        // __PAREN__ is placed first in the replacement chain so any inner tokens still get resolved.
        text = text.replace(/\(([^)\n]+)\)/g, (match, content) => {
            parenParts.push(content);
            return `__PAREN_${parenParts.length - 1}__`;
        });

        const escapeHtml = (value) =>
            value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

        text = escapeHtml(text);

        // Collapse multiple consecutive newlines to a single one to reduce visual gap
        text = text.replace(/\n{2,}/g, '\n');

        // Split into lines; insert spacing before headings and citation blocks
        const lines = text.split('\n');
        const segments = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (segments.length > 0) {
                // Blank line before headings
                if (/^__HEADING_BOLD_\d+__$/.test(trimmed)) {
                    segments.push('');
                }
                // Small-gap line before citation blocks (grey quote lines)
                if (/^__QUOT_\d+__/.test(trimmed)) {
                    segments.push('<span style="display:block;height:0.3rem"></span>');
                }
            }
            segments.push(line);
        }

        let html = segments.join('<br/>');

        // __PAREN__ first so any inner tokens (__BOLD__, __ITAL__, etc.) are resolved by subsequent steps
        html = html.replace(/__PAREN_(\d+)__/g, (match, idx) => {
            const content = parenParts[Number(idx)] || '';
            return `<span style="font-size:0.82em">(${escapeHtml(content)})</span>`;
        });

        html = html.replace(/__HEADING_BOLD_(\d+)__/g, (match, idx) => {
            const content = headingParts[Number(idx)] || '';
            return `<strong>${escapeHtml(content)}</strong><hr class=”llm-bold-separator”/>`;
        });
        html = html.replace(/__BOLD_(\d+)__/g, (match, idx) => {
            const content = boldParts[Number(idx)] || '';
            return `<strong>${escapeHtml(content)}</strong>`;
        });
        html = html.replace(/__ITAL_(\d+)__/g, (match, idx) => {
            const content = italicParts[Number(idx)] || '';
            return `<em>${escapeHtml(content)}</em>`;
        });
        html = html.replace(/__QUOT_(\d+)__/g, (match, idx) => {
            const content = quoteParts[Number(idx)] || '';
            return `<span style="background-color:#f1f5f9;border-left:3px solid #94a3b8;padding:0.25em 0.5em;display:inline-block;font-style:italic;border-radius:0 4px 4px 0">${escapeHtml(content)}</span>`;
        });
        html = html.replace(/__CITE_(\d+)__/g, (match, idx) => {
            const content = citationParts[Number(idx)] || '';
            const escaped = escapeHtml(content);
            return `<div style=”display:block;text-align:right;margin-top:0.1rem”><sub style=”font-size:0.65em;color:#475569;font-style:italic”>${escaped}</sub></div>`;
        });
        html = html.replace(/__CODE_(\d+)__/g, (match, idx) => {
            const content = codeParts[Number(idx)] || '';
            return `<span class=”llm-code”>${escapeHtml(content)}</span>`;
        });

        // Change #1: citation divs are display:block so they create their own line break;
        // remove the extra <br/> the segment join places immediately after </div> to avoid double-spacing.
        html = html.replace(/<\/div><br\/>/g, '</div>');

        // Resolve detail-prompt break markers inserted before tokenization
        html = html.replace(/@@BREAK@@/g, '<br/>');

        return html;
    };

    const parseReference = (ref) => {
        const withoutFileUrl = ref.replace(/file_url\s*:\s*/i, '').trim();
        const urlMatch = withoutFileUrl.match(/https?:\/\/\S+/);
        let text = withoutFileUrl
            .replace(urlMatch?.[0] || '', '')
            .trim()
            .replace(/[-–—\s]+$/, '');
        text = text.replace(/((?:Page|पृष्ठ)\s*\d+)\s*[^-–—\s]*$/i, '$1');
        text = text.replace(/[),.।;:]+$/g, '').trim();
        return {
            text,
            url: urlMatch ? urlMatch[0] : null
        };
    };

    const getCitationCategoryMeta = (category) => {
        switch (category) {
            case 'Pravachan':
                return {
                    emoji: '🎙️',
                    label: 'Pravachan',
                    cardClassName: 'bg-white border-sky-200',
                    badgeClassName: 'bg-sky-50 text-sky-700 border-sky-200',
                    numberClassName: 'bg-sky-50 text-sky-700'
                };
            case 'Granth':
                return {
                    emoji: '📜',
                    label: 'Granth',
                    cardClassName: 'bg-white border-rose-200',
                    badgeClassName: 'bg-rose-50 text-rose-700 border-rose-200',
                    numberClassName: 'bg-rose-50 text-rose-700'
                };
            case 'Books':
                return {
                    emoji: '📚',
                    label: 'Books',
                    cardClassName: 'bg-white border-emerald-200',
                    badgeClassName: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    numberClassName: 'bg-emerald-50 text-emerald-700'
                };
            default:
                return {
                    emoji: '📄',
                    label: 'Reference',
                    cardClassName: 'bg-slate-50 border-slate-200',
                    badgeClassName: 'bg-slate-100 text-slate-700 border-slate-200',
                    numberClassName: 'bg-slate-200 text-slate-600'
                };
        }
    };

    const getCitationLocationLabel = (citation) => {
        if (!citation) return '';

        const locationParts = [
            citation.verse_type && citation.verse_number !== undefined
                ? `${citation.verse_type} ${citation.verse_number}`
                : null,
            citation.gatha !== undefined && citation.gatha !== null ? `Gatha ${citation.gatha}` : null,
            citation.shlok !== undefined && citation.shlok !== null ? `Shlok ${citation.shlok}` : null,
            citation.dohra !== undefined && citation.dohra !== null ? `Dohra ${citation.dohra}` : null,
            citation.doha !== undefined && citation.doha !== null ? `Doha ${citation.doha}` : null,
            citation.kalash !== undefined && citation.kalash !== null ? `Kalash ${citation.kalash}` : null,
            citation.sutra !== undefined && citation.sutra !== null ? `Sutra ${citation.sutra}` : null,
        ].filter(Boolean);

        return locationParts.join(' · ');
    };

    const getAibotReferenceCardData = (citation, ref) => {
        const fallback = parseReference(ref);
        const categoryMeta = getCitationCategoryMeta(citation?.category);
        const locationLabel = getCitationLocationLabel(citation);
        const granthLineBase = citation?.granth || fallback.text || ref;
        const title = locationLabel
            ? `${categoryMeta.emoji} ${granthLineBase} (${locationLabel})`
            : `${categoryMeta.emoji} ${granthLineBase}`;
        const speaker = citation?.pravachankar || citation?.Pravachankar;

        const detailParts = [];
        if (citation?.series) detailParts.push(citation.series);
        if (citation?.volume !== undefined && citation?.volume !== null && citation?.volume !== '') {
            detailParts.push(`Volume ${citation.volume}`);
        }
        if (citation?.pravachan_number) detailParts.push(`Pravachan Number ${citation.pravachan_number}`);
        if (citation?.page_number !== undefined && citation?.page_number !== null && citation?.page_number !== '') {
            detailParts.push(`Page ${citation.page_number}`);
        }

        const lines = [];
        if (citation?.category === 'Pravachan') {
            if (speaker) lines.push(speaker);
            if (detailParts.length) lines.push(detailParts.join(', '));
        } else {
            if (citation?.author) lines.push(citation.author);
            if (detailParts.length) lines.push(detailParts.join(', '));
        }

        return {
            title,
            lines,
            categoryLabel: categoryMeta.label,
            cardClassName: categoryMeta.cardClassName,
            badgeClassName: categoryMeta.badgeClassName,
            numberClassName: categoryMeta.numberClassName,
            readChunkId: citation?.chunk_id || null,
            viewPdfUrl: citation?.file_url || fallback.url || null
        };
    };

    return (
        <div style={{ backgroundColor: '#f0f4f9', '--bg-card': '#ffffff', '--bg-surface': '#dce7f0' }} className="text-slate-900 min-h-screen font-sans">
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
                <div className="fixed bottom-4 left-4 z-50 bg-orange-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg select-none" title="Debug mode is on — all categories visible. Never enabled in production.">
                    DEBUG
                </div>
            )}
            <Navigation currentPage={currentPage} setCurrentPage={setCurrentPage} debugMode={debugMode} isChatMode={isChatMode} onNewChat={handleNewChat} />
            
            <div className="container mx-auto p-4 md:p-5">
                <div className="max-w-[1080px] mx-auto">
                    <Header currentPage={currentPage} />

                    {currentPage === 'aibot' && !llmAvailable && (
                        <main>
                            <div className="text-center py-16">
                                <p className="text-slate-500 text-lg">AI Service is unavailable right now.</p>
                            </div>
                        </main>
                    )}

                    {showSearchInterface && (
                        <main>

                            {/* ── SEARCH MODE ── */}
                            {!isChatMode && (
                                <>
                                    <SearchableContentWidget />
                                    <div style={{ backgroundColor: 'var(--bg-card)' }} className="bg-white p-3 rounded shadow-sm border border-slate-200 mb-4">
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
                                                className="bg-sky-600 text-white font-semibold h-8 px-4 rounded text-sm hover:bg-sky-700 active:bg-sky-800 transition duration-200 disabled:bg-slate-300 flex items-center justify-center whitespace-nowrap"
                                            >
                                                {isLoading ? <Spinner /> : 'Search'}
                                            </button>
                                        </div>
                                        <div className="flex items-center justify-between mt-3">
                                            <button
                                                onClick={() => setShowFilters(!showFilters)}
                                                className="flex items-center text-sky-700 font-semibold hover:text-sky-800 text-sm whitespace-nowrap"
                                            >
                                                {showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
                                                {showFilters ? 'Hide Filters' : 'Show Filters'}
                                            </button>
                                            <button
                                                onClick={() => setShowTipsModal(true)}
                                                className="flex items-center text-sky-700 font-semibold hover:text-sky-800 text-sm"
                                                aria-label="Show search tips"
                                            >
                                                <ExpandIcon />
                                                Tips for writing good queries
                                            </button>
                                        </div>
                                        {showFilters && (
                                            <div className="mt-4 border-t border-slate-200 pt-4">
                                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
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

                                    {homeMode && llmAvailable && (llmAnswer || llmError || llmLoading) && (
                                        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="text-lg font-semibold text-slate-800">Answer</h3>
                                                {llmLoading && (
                                                    <div className="flex items-center text-sm text-slate-500">
                                                        <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-lime-500 mr-2"></div>
                                                        Generating...
                                                    </div>
                                                )}
                                            </div>
                                            {llmError && <div className="text-red-600 text-sm">{llmError}</div>}
                                            {(llmAnswer || llmReferences.length > 0) && (
                                                <div className="llm-answer-scroll">
                                                    {llmAnswer && (
                                                        <div className="text-slate-800 leading-relaxed text-base"
                                                            dangerouslySetInnerHTML={{ __html: formatAnswerHtml(llmAnswer) }} />
                                                    )}
                                                    {llmReferences.length > 0 && (
                                                        <div className="mt-4 border-t border-slate-200 pt-3">
                                                            <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-2">References</h4>
                                                            <div className="space-y-2">
                                                                {llmReferences.map((ref, idx) => {
                                                                    const { text, url } = parseReference(ref);
                                                                    const citation = llmCitations.find(c => c.reference === ref);
                                                                    return (
                                                                        <div key={`${ref}-${idx}`} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                                                            <span className="flex-1">{text || ref}</span>
                                                                            <div className="flex items-center gap-2 whitespace-nowrap">
                                                                                {citation && (
                                                                                    <button onClick={() => handleExpand(citation.chunk_id)}
                                                                                        className="text-slate-500 hover:text-slate-800 font-medium underline underline-offset-2">
                                                                                        View text
                                                                                    </button>
                                                                                )}
                                                                                {url && (
                                                                                    <a href={url} target="_blank" rel="noopener noreferrer"
                                                                                        className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 bg-white border border-slate-300 rounded px-2 py-1 hover:border-red-300 transition-colors">
                                                                                        <PdfIcon />View PDF
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {homeMode && (isLoading || searchData || similarDocumentsData) && (
                                        <div className="mt-4">
                                            <SuggestionsCard
                                                suggestions={searchData?.suggestions}
                                                originalQuery={query}
                                                onSuggestionClick={handleSuggestionClick}
                                                hasResults={loadingCategories.size > 0 || (searchData?.pravachan_results?.total_hits || 0) > 0 || (searchData?.granth_results?.total_hits || 0) > 0 || (searchData?.books_results?.total_hits || 0) > 0}
                                            />
                                            {searchData && query && (
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className="text-sm text-slate-900">
                                                        <span className="font-semibold text-slate-900">
                                                            {((searchData.pravachan_results?.total_hits || 0) + (searchData.granth_results?.total_hits || 0) + (searchData.books_results?.total_hits || 0)).toLocaleString()}
                                                        </span> results for <span className="font-semibold text-slate-800">"{query}"</span>
                                                    </p>
                                                    <button onClick={toggleCompact}
                                                        className="text-xs text-slate-700 hover:text-slate-900 flex items-center gap-1 transition-colors font-medium"
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
                                            <div className="flex items-start gap-2.5 px-3.5 py-2.5 mb-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs leading-relaxed">
                                                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                                </svg>
                                                <span><strong>Note:</strong> Text from Pravachans and Granths is extracted via OCR and results are ranked by AI — both may contain errors. For <strong>accurate reference</strong>, please use the <strong>original PDFs</strong> linked alongside each result.</span>
                                            </div>
                                            <div style={{ backgroundColor: 'var(--bg-card)' }} className="border border-slate-200 rounded shadow-sm overflow-hidden">
                                                <Tabs activeTab={activeTab} setActiveTab={setActiveTab} searchData={searchData}
                                                    similarDocumentsData={similarDocumentsData} onClearSimilar={handleClearSimilar}
                                                    loadingCategories={loadingCategories} activeCategories={activeCategories} />
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
                                                            <div className="text-center py-8 text-sm text-slate-500">No similar documents found.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {homeMode && !isLoading && !searchData && !similarDocumentsData && (
                                        <div className="mt-5">
                                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-2.5 font-medium">Try searching for</p>
                                            <div className="flex flex-wrap gap-2">
                                                {suggestedQueries.map(term => (
                                                    <button key={term} onClick={() => handleSuggestionClick(term)}
                                                        className="px-3 py-1 text-sm bg-white border border-slate-200 rounded text-slate-600 hover:border-sky-300 hover:text-sky-700 hover:bg-sky-50 transition-colors">
                                                        {term}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ── CHAT MODE ── */}
                            {isChatMode && llmAvailable && (
                                <>
                                    {/* Empty state — centered search bar */}
                                    {chatMessages.length === 0 && !llmLoading && (
                                        <div className="flex flex-col items-center justify-center py-16">
                                            <div className="w-full max-w-4xl space-y-6">
                                                <div className="w-full">
                                                    <SearchableContentWidget />
                                                </div>
                                                <div className="w-full">
                                                    <div className="flex items-center gap-2 rounded-2xl border border-slate-400 bg-white/95 backdrop-blur-sm shadow-md px-3 py-3">
                                                        <button
                                                            onClick={handleNewChat}
                                                            title="New Chat"
                                                            className="h-8 w-8 flex items-center justify-center rounded-full border border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200 hover:border-sky-400 transition-colors text-xl font-bold leading-none shrink-0"
                                                        >
                                                            +
                                                        </button>
                                                        <div className="flex-grow">
                                                            <SearchBar
                                                                query={query}
                                                                setQuery={setQuery}
                                                                onSearch={() => query.trim() && handleChatStart(query)}
                                                                language={language}
                                                            />
                                                        </div>
                                                        <SearchOptions language={language} setLanguage={setLanguage} inline />
                                                        <button
                                                            onClick={() => query.trim() && handleChatStart(query)}
                                                            disabled={!query.trim()}
                                                            className="bg-sky-600 text-white h-8 w-8 rounded-full border border-sky-700 hover:bg-sky-700 hover:border-sky-800 transition duration-200 disabled:bg-slate-300 disabled:border-slate-300 flex items-center justify-center shrink-0"
                                                            aria-label="Send"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="w-full pt-1">
                                                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-3 font-medium text-center">Try asking</p>
                                                    <div className="flex flex-wrap gap-2 justify-center">
                                                        {suggestedQueries.map(term => (
                                                            <button key={term} onClick={() => handleChatStart(term)}
                                                                className="px-3 py-1 text-sm bg-white border border-slate-200 rounded text-slate-600 hover:border-lime-300 hover:text-lime-700 hover:bg-lime-50 transition-colors">
                                                                {term}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Active chat state */}
                                    {(chatMessages.length > 0 || llmLoading) && (
                                        <div className="flex flex-col max-w-4xl mx-auto w-full min-h-[calc(100vh-240px)]">
                                            {/* Messages */}
                                            <div className="flex-1 py-4 space-y-6">
                                                {chatMessages.map((msg, idx) => (
                                                    <div key={`${msg.role}-${idx}`}>
                                                        {msg.role === 'user' ? (
                                                            <div className="flex justify-end">
                                                                <div className="bg-sky-600 shadow-sm rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%] text-white text-base">
                                                                    {msg.content}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div>
                                                                <div className="text-sm font-bold mb-3 uppercase tracking-[0.12em] text-slate-900">Answer</div>
                                                                {msg.pending ? (
                                                                    <div className="flex items-center text-sm text-slate-500 gap-2">
                                                                        <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-lime-500"></div>
                                                                        Generating...
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <div className="text-slate-900 leading-relaxed text-base"
                                                                            dangerouslySetInnerHTML={{ __html: formatAnswerHtml(
                                                                                displayedTexts[idx] !== undefined ? displayedTexts[idx] : msg.content || ''
                                                                            )}} />
                                                                        {displayedTexts[idx] === msg.content && msg.content && (
                                                                            <div className="mt-3 flex justify-end">
                                                                                <CopyAnswerButton text={cleanAnswerText(msg.content)} />
                                                                            </div>
                                                                        )}
                                                                        {displayedTexts[idx] === msg.content && msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                                                                            <div className="mt-6 rounded-xl border border-sky-100 bg-sky-50 p-4">
                                                                                <p className="text-xs font-bold uppercase tracking-wide text-sky-800 mb-2.5">
                                                                                    💡 Suggested Follow up questions
                                                                                </p>
                                                                                <div className="flex flex-wrap gap-2">
                                                                                    {msg.follow_up_questions.map((question, questionIdx) => (
                                                                                        <button
                                                                                            key={`${idx}-follow-up-${questionIdx}`}
                                                                                            onClick={() => handleChatSend(chatSessionId, question)}
                                                                                            disabled={llmLoading || !chatSessionId}
                                                                                            className="px-3 py-1 text-sm bg-white border border-sky-200 rounded text-sky-900 hover:border-sky-300 hover:text-sky-950 hover:bg-sky-50 transition-colors disabled:bg-sky-50 disabled:text-slate-400 disabled:border-sky-100"
                                                                                        >
                                                                                            {question}
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {displayedTexts[idx] === msg.content && msg.references && msg.references.length > 0 && (
                                                                            <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-4">
                                                                                <h4 className="text-xs font-bold uppercase tracking-wide text-sky-800 mb-3">📖 References</h4>
                                                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                                                    {msg.references.map((ref, refIdx) => {
                                                                                        const citation = (msg.citations || []).find(c => c.reference === ref) || msg.citations?.[refIdx];
                                                                                        const card = getAibotReferenceCardData(citation, ref);
                                                                                        return (
                                                                                            <div key={`${ref}-${refIdx}`} className={`flex flex-col justify-between border rounded-lg p-3 text-sm ${card.cardClassName}`}>
                                                                                                <div className="mb-3">
                                                                                                    <div className="mb-2 flex items-start justify-between gap-2">
                                                                                                        <span className={`inline-block text-xs font-bold rounded px-1.5 py-0.5 ${card.numberClassName}`}>{refIdx + 1}</span>
                                                                                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${card.badgeClassName}`}>
                                                                                                            {card.categoryLabel}
                                                                                                        </span>
                                                                                                    </div>
                                                                                                    <p className="font-bold text-slate-900 leading-snug">{card.title}</p>
                                                                                                    <div className="mt-2 space-y-1 text-slate-800 leading-snug">
                                                                                                        {card.lines.map((line, lineIdx) => (
                                                                                                            <p key={`${refIdx}-${lineIdx}`} className="break-words">
                                                                                                                {line}
                                                                                                            </p>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-2">
                                                                                                    {card.readChunkId && (
                                                                                                        <button onClick={() => handleExpand(card.readChunkId)}
                                                                                                            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded px-2 py-1 transition-colors">
                                                                                                            Expand
                                                                                                        </button>
                                                                                                    )}
                                                                                                    {card.viewPdfUrl && (
                                                                                                        <a href={card.viewPdfUrl} target="_blank" rel="noopener noreferrer"
                                                                                                            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 bg-white border border-slate-300 rounded px-2 py-1 hover:border-red-300 transition-colors">
                                                                                                            <PdfIcon />View PDF
                                                                                                        </a>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                                {llmError && <div className="text-red-600 text-sm">{llmError}</div>}
                                                <div ref={messagesEndRef} />
                                            </div>

                                            {/* Sticky bottom input */}
                                            <div className="sticky bottom-0 mt-auto pt-3 pb-4 shrink-0" style={{ backgroundColor: '#f0f4f9' }}>
                                                <div className="flex items-center gap-2 rounded-2xl border border-slate-400 bg-white/95 backdrop-blur-sm shadow-md px-3 py-3">
                                                    <button
                                                        onClick={handleNewChat}
                                                        title="New Chat"
                                                        className="h-8 w-8 flex items-center justify-center rounded-full border border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200 hover:border-sky-400 transition-colors text-xl font-bold leading-none shrink-0"
                                                    >
                                                        +
                                                    </button>
                                                    <div className="flex-grow">
                                                        <SearchBar
                                                            query={chatInput}
                                                            setQuery={setChatInput}
                                                            onSearch={() => chatInput.trim() && !llmLoading && handleChatSend(chatSessionId, chatInput)}
                                                            language={language}
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => handleChatSend(chatSessionId, chatInput)}
                                                        disabled={llmLoading || !chatInput.trim()}
                                                        className="bg-sky-600 text-white h-8 w-8 rounded-full border border-sky-700 hover:bg-sky-700 hover:border-sky-800 transition duration-200 disabled:bg-slate-300 disabled:border-slate-300 flex items-center justify-center shrink-0"
                                                        aria-label="Send"
                                                    >
                                                        {llmLoading ? <Spinner /> : (
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                </div>
                                                <div className="flex items-start gap-2.5 px-3.5 py-2.5 mt-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs leading-relaxed">
                                                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                                    </svg>
                                                    <span>Swalakshya AI Bot uses AI to generate answers, which may sometimes be <strong>inaccurate</strong>. Always refer to the <strong>original scriptures and references</strong> attached to each answer to study authentic content and <strong>stay true to Jinvaani</strong>. Use this bot as a <strong>starting point</strong>, not as a <strong>definitive source</strong>.</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
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

// Admin route wrapper — persists session token in localStorage (survives tab close, expires after 1 day)
function AdminRoute() {
    React.useEffect(() => { document.title = 'Swalakshya · Admin'; }, []);
    const [token, setToken] = React.useState(() => localStorage.getItem('adminToken'));
    const handleAuth = (t) => { localStorage.setItem('adminToken', t); setToken(t); };
    const handleLogout = () => { localStorage.removeItem('adminToken'); setToken(null); };
    if (!token) return <AdminLoginPage onAuth={handleAuth} />;
    return <AdminPageComponent token={token} onLogout={handleLogout} />;
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
                <Route path="/aibot" element={<AppContent />} />
                <Route path="/admin" element={<AdminRoute />} />
            </Routes>
        </Router>
    );
}
