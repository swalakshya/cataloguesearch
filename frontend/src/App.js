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
import { FeedbackButtons } from './components/AibotFeedback';
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

// --- CHAT FILTERS COMPONENT ---
const CATEGORY_EMOJI = { Pravachan: '🎙️', Granth: '📜', Books: '📚' };

const ChatFilters = ({ activeCategories, debugMode, chatContentTypes, setChatContentTypes, chatShastras, setChatShastras, allMetadata, language, dropUp = false }) => {
    const [shastraOpen, setShastraOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        if (!shastraOpen) return;
        const handle = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShastraOpen(false); };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [shastraOpen]);

    const shastraOptions = useMemo(() => {
        const names = new Set();
        chatContentTypes.forEach(cat => {
            const catMeta = allMetadata[cat]?.[language];
            if (catMeta?.Name) catMeta.Name.forEach(n => names.add(n));
        });
        return [...names].sort();
    }, [chatContentTypes, allMetadata, language]);

    useEffect(() => {
        const valid = new Set(shastraOptions);
        const filtered = chatShastras.filter(s => valid.has(s));
        if (filtered.length !== chatShastras.length) setChatShastras(filtered);
    }, [shastraOptions]); // eslint-disable-line react-hooks/exhaustive-deps

    const visibleCategories = [
        ...activeCategories,
        ...(debugMode && !activeCategories.includes('Books') ? ['Books'] : [])
    ];

    const toggleCategory = (cat) => {
        setChatContentTypes(prev => {
            if (prev.includes(cat)) {
                if (prev.length === 1) return prev;
                return prev.filter(c => c !== cat);
            }
            return [...prev, cat];
        });
    };

    const toggleShastra = (name) => {
        setChatShastras(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
    };

    const shastraLabel = chatShastras.length === 0
        ? 'All Shastras'
        : chatShastras.length === 1
            ? chatShastras[0]
            : `${chatShastras.length} Shastras`;

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {visibleCategories.map(cat => {
                const active = chatContentTypes.includes(cat);
                return (
                    <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium border transition-colors ${
                            active ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
                        }`}
                    >
                        <span>{CATEGORY_EMOJI[cat]}</span>
                        <span>{cat}</span>
                    </button>
                );
            })}
            {shastraOptions.length > 0 && (
                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setShastraOpen(v => !v)}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium border transition-colors ${
                            chatShastras.length > 0 ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
                        }`}
                    >
                        <span className="max-w-[160px] truncate">{shastraLabel}</span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={dropUp ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                        </svg>
                    </button>
                    {shastraOpen && (
                        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 z-50 bg-white border border-slate-200 rounded shadow-lg w-64 max-h-60 overflow-y-auto`}>
                            {chatShastras.length > 0 && (
                                <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                                    <span className="text-xs text-slate-500">{chatShastras.length} selected</span>
                                    <button onClick={() => setChatShastras([])} className="text-xs text-sky-600 hover:text-sky-800 font-medium">Clear all</button>
                                </div>
                            )}
                            {shastraOptions.map(name => {
                                const selected = chatShastras.includes(name);
                                return (
                                    <button
                                        key={name}
                                        onClick={() => toggleShastra(name)}
                                        className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition-colors flex items-center gap-2 ${selected ? 'text-sky-700' : 'text-slate-700'}`}
                                    >
                                        <span className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${selected ? 'bg-sky-600 border-sky-600' : 'border-slate-300'}`}>
                                            {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                                        </span>
                                        <span>{name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// --- USER IDENTITY ---
function getOrCreateUserId() {
    const key = 'swalakshya_user_id';
    let id = localStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
    }
    return id;
}
const USER_ID = getOrCreateUserId();

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
        return 'home'; // Default to 'home' for root path
    });
    
    // Update state when URL changes (browser navigation)
    useEffect(() => {
        const path = location.pathname;
        setHomeMode(path === '/chat' ? 'chat' : 'search');
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
        setChatContentTypes([...activeCategories]);
        setChatShastras([]);
        setHomeMode('search');
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
    const [chatNotice, setChatNotice] = useState(null);
    const [llmLoading, setLlmLoading] = useState(false);
    const [chatSessionId, setChatSessionId] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatInputVisible, setChatInputVisible] = useState(false);
    const [chatContentTypes, setChatContentTypes] = useState(['Pravachan', 'Granth']);
    const [chatShastras, setChatShastras] = useState([]);
    const [expandedAnswers, setExpandedAnswers] = useState({});
    const PAGE_SIZE = 20;
    const llmProvider = (process.env.REACT_APP_LLM_PROVIDER || '').trim();
    const [llmAvailable, setLlmAvailable] = useState(false);
    const [homeMode, setHomeMode] = useState(() => location.pathname === '/chat' ? 'chat' : 'search');
    const [displayedTexts, setDisplayedTexts] = useState({});
    const [chunkTextsCache, setChunkTextsCache] = useState({});
    const typingIntervalsRef = useRef({});
    const recoveryTimeoutRef = useRef(null);
    const messagesEndRef = useRef(null);
    const latestUserBubbleRef = useRef(null);
    const activeChatRunRef = useRef(0);
    const [showScrollDown, setShowScrollDown] = useState(false);
    const isChatMode = homeMode === 'chat';
    const chatEnabled = isChatMode;
    const hasPendingChatMessage = chatMessages.some(msg => msg.role === 'assistant' && msg.pending);

    const beginChatRun = useCallback(() => {
        activeChatRunRef.current += 1;
        return activeChatRunRef.current;
    }, []);

    const isActiveChatRun = useCallback((runId) => activeChatRunRef.current === runId, []);

    const invalidateChatRuns = useCallback(() => {
        activeChatRunRef.current += 1;
    }, []);

    const clearPendingMessage = useCallback((sessionId) => {
        if (!sessionId) return;
        try {
            localStorage.removeItem(`pending_msg_${sessionId}`);
        } catch {}
    }, []);

    const resetTypingState = useCallback(() => {
        Object.values(typingIntervalsRef.current).forEach(clearInterval);
        typingIntervalsRef.current = {};
        setDisplayedTexts({});
        setExpandedAnswers({});
    }, []);

    const clearPersistedChatSession = useCallback(() => {
        try {
            localStorage.removeItem('llmChatSession');
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, []);

    const clearRecoveryTimer = useCallback(() => {
        if (recoveryTimeoutRef.current) {
            clearTimeout(recoveryTimeoutRef.current);
            recoveryTimeoutRef.current = null;
        }
    }, []);

    function schedulePendingRecovery(sessionId, runId, delayMs = 1500) {
        clearRecoveryTimer();
        recoveryTimeoutRef.current = setTimeout(() => {
            recoveryTimeoutRef.current = null;
            if (isActiveChatRun(runId)) {
                void recoverPendingMessage(sessionId, runId);
            }
        }, delayMs);
    }

    async function recoverPendingMessage(sessionId, runId = activeChatRunRef.current || beginChatRun()) {
        if (!sessionId || !isActiveChatRun(runId)) return;

        const pendingKey = `pending_msg_${sessionId}`;
        let pending = null;
        try { pending = JSON.parse(localStorage.getItem(pendingKey)); } catch {}
        if (!pending?.messageId) return;

        setChatMessages(prev => {
            const hasPending = prev.some(m => m.role === 'assistant' && m.pending);
            if (hasPending) return prev;
            return [...prev, { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question' }];
        });

        try {
            const jobStatus = await api.getChatMessageResult(sessionId, pending.messageId);
            if (!isActiveChatRun(runId)) return;

            if (jobStatus.status === 'done') {
                const { status: _s, message_id: _m, ...result } = jobStatus;
                applyChatResponse(result, null);
                clearPendingMessage(sessionId);
                clearRecoveryTimer();
                setChatNotice(null);
                setLlmLoading(false);
                return;
            }

            if (jobStatus.status !== 'processing') return;

            setLlmLoading(true);
            const saveCursor = (id) => {
                try {
                    const raw = localStorage.getItem(pendingKey);
                    if (raw) {
                        const payload = JSON.parse(raw);
                        payload.lastEventId = id;
                        localStorage.setItem(pendingKey, JSON.stringify(payload));
                    }
                } catch {}
            };

            try {
                const data = await api.streamChatMessageResult(sessionId, pending.messageId, {
                    lastEventId: pending.lastEventId ?? null,
                    onEvent: (event) => {
                        if (!isActiveChatRun(runId) || event?.type !== 'stage') return;
                        setChatMessages(prev => {
                            const updated = [...prev];
                            const idx = updated.findIndex(m => m.role === 'assistant' && m.pending);
                            if (idx !== -1) updated[idx] = { ...updated[idx], stage: event.stage, stageLabel: event.label };
                            return updated;
                        });
                    },
                    onEventId: saveCursor,
                });
                if (!isActiveChatRun(runId)) return;
                if (data) {
                    applyChatResponse(data, null);
                    clearPendingMessage(sessionId);
                    clearRecoveryTimer();
                    setChatNotice(null);
                }
            } catch (err) {
                if (!isActiveChatRun(runId)) return;
                if (err?.status === 404) {
                    clearPendingMessage(sessionId);
                    clearRecoveryTimer();
                    setChatMessages(prev => prev.filter(m => !(m.role === 'assistant' && m.pending)));
                    setChatNotice('Response was lost while the app was in the background. Please send your question again.');
                    setTimeout(() => setChatNotice(null), 6000);
                } else {
                    setLlmError(null);
                    setChatNotice('Connection interrupted. We’ll reconnect.');
                    schedulePendingRecovery(sessionId, runId);
                }
            } finally {
                if (isActiveChatRun(runId)) setLlmLoading(false);
            }
        } catch (err) {
            if (!isActiveChatRun(runId)) return;
            if (err?.status === 404) {
                clearPendingMessage(sessionId);
                clearRecoveryTimer();
                setChatMessages(prev => prev.filter(m => !(m.role === 'assistant' && m.pending)));
                setChatNotice('Response was lost while the app was in the background. Please send your question again.');
                setTimeout(() => setChatNotice(null), 6000);
            } else {
                setLlmError(null);
                setChatNotice('Connection interrupted. We’ll reconnect.');
                schedulePendingRecovery(sessionId, runId);
            }
        }
    }

    useEffect(() => {
        api.checkLlmHealth().then(setLlmAvailable);
    }, []);

    // Typing effect: reveal each new assistant message character by character
    useEffect(() => {
        chatMessages.forEach((msg, idx) => {
            if (msg.role === 'assistant' && !msg.pending && msg.content &&
                displayedTexts[idx] === undefined && !typingIntervalsRef.current[idx]) {
                let charIdx = 0;
                const fullText = cleanAnswerText(msg.content);
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

    // Scroll new user bubble just below the sticky nav when a question is submitted
    useEffect(() => {
        const msgs = chatMessages;
        if (msgs.length < 2) return;
        const last = msgs[msgs.length - 1];
        const secondLast = msgs[msgs.length - 2];
        if (last?.pending && secondLast?.role === 'user') {
            const el = latestUserBubbleRef.current;
            if (el) {
                const NAV_HEIGHT = 64; // h-16
                const PADDING = 12;
                const top = el.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT - PADDING;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        }
    }, [chatMessages]);

    // Show/hide scroll-down arrow via IntersectionObserver on messagesEndRef sentinel
    useEffect(() => {
        const el = messagesEndRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setShowScrollDown(!entry.isIntersecting),
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [chatMessages.length, llmLoading]); // re-attach when chat activates/deactivates

    useEffect(() => {
        if (currentPage === 'home') {
            document.title = 'Swa Lakshya (स्व-लक्ष्य)';
            return;
        }
        const overrides = {
            'chat':         'AI Bot',
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
            setChatContentTypes([...cfg.active_categories]);
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
                                acc[idx] = cleanAnswerText(msg.content);
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

    // SF3: visibilitychange handler — recover an in-flight message when the tab returns
    useEffect(() => {
        if (!chatEnabled || !chatSessionId) return;

        const onVisible = async () => {
            if (document.visibilityState !== 'visible') return;
            void recoverPendingMessage(chatSessionId);
        };

        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [chatEnabled, chatSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    // SF3: on startup, check if a message was in-flight when the app was last closed
    useEffect(() => {
        if (!chatEnabled || !chatSessionId) return;
        void recoverPendingMessage(chatSessionId);
    }, [chatEnabled, chatSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    const getChatSessionPayload = useCallback(() => {
        const languageCode = language === 'gujarati' ? 'gu' : 'hi';
        return {
            language: languageCode,
            user_id: USER_ID,
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
        // In chat mode, use user's chat filter selection
        const types = isChatMode
            ? [...chatContentTypes]
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

        if (isChatMode && chatShastras.length > 0) filters.granth = chatShastras;

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

    // Renders a completed LLM response into chatMessages (replaces the pending placeholder).
    // question is stored on the msg for follow-up navigation; uses preTokenizeCitations from outer scope.
    function applyChatResponse(data, question) {
        setChatMessages(prev => {
            const { content, citationBlocks } = preTokenizeCitations(data.answer || '');
            const updated = [...prev];
            const idx = updated.findIndex(item => item.role === 'assistant' && item.pending);
            const msg = {
                role: 'assistant',
                content,
                citationBlocks,
                follow_up_questions: data.follow_up_questions || [],
                references: data.references || [],
                citations: data.citations || [],
                tool_trace_id: data.tool_trace_id || null,
                question: question || '',
                rawAnswer: data.answer || '',
            };
            if (idx !== -1) { updated[idx] = msg; return updated; }
            return [...updated, msg];
        });

        // Fetch inline chunk quote text in background
        const chunkIdMatches = [...(data.answer || '').matchAll(/^\s*>\s*\{\{([^}]+)\}\}\s*$/gm)];
        if (chunkIdMatches.length > 0) {
            const uniqueIds = [...new Set(chunkIdMatches.map(m => m[1]))];
            const toFetch = uniqueIds.filter(id => !chunkTextsCache[id]);
            if (toFetch.length > 0) {
                const languageCode = language === 'gujarati' ? 'gu' : 'hi';
                Promise.all(toFetch.map(id => api.getChunk(id, languageCode))).then(results => {
                    const fetched = {};
                    results.forEach((res, i) => { if (res?.text_content) fetched[toFetch[i]] = res; });
                    if (Object.keys(fetched).length > 0) setChunkTextsCache(prev => ({ ...prev, ...fetched }));
                });
            }
        }
    }

    async function handleChatSend(sessionId, message, { runId: providedRunId = null } = {}) {
        if (!message.trim()) return;
        const runId = providedRunId ?? beginChatRun();
        let activeSessionId = sessionId;

        setLlmLoading(true);
        setLlmError(null);
        setChatNotice(null);
        setChatMessages(prev => [
            ...prev,
            { role: 'user', content: message },
            { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question' }
        ]);
        setChatInput('');
        setChatInputVisible(false);

        const onStageEvent = (event) => {
            if (!isActiveChatRun(runId) || event?.type !== 'stage') return;
            setChatMessages(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(item => item.role === 'assistant' && item.pending);
                if (idx !== -1) {
                    updated[idx] = {
                        ...updated[idx],
                        stage: event.stage || updated[idx].stage,
                        stageLabel: event.label || updated[idx].stageLabel
                    };
                }
                return updated;
            });
        };

        // Build a submit+stream function for a given session, storing cursor in localStorage
        const streamForSession = async (targetSessionId, clientMsgId) => {
            const pendingKey = `pending_msg_${targetSessionId}`;
            const saveCursor = (lastEventId) => {
                try { localStorage.setItem(pendingKey, JSON.stringify({ messageId: clientMsgId, lastEventId })); } catch {}
            };

            // Optimistically record that a message is in-flight BEFORE submitting,
            // so visibilitychange can recover even if the POST response is lost.
            saveCursor(null);

            const { message_id: messageId } = await api.submitChatMessage(targetSessionId, {
                role: 'user',
                content: message,
                response_format: 'structured',
                filters: buildLlmFilters(),
                client_message_id: clientMsgId,
            });

            return api.streamChatMessageResult(targetSessionId, messageId, {
                lastEventId: null,
                onEvent: onStageEvent,
                onEventId: saveCursor,
            });
        };

        // Generate a stable client-side message ID for idempotency
        const clientMsgId = crypto.randomUUID();

        try {
            let data;
            try {
                data = await streamForSession(sessionId, clientMsgId);
            } catch (error) {
                if (!isActiveChatRun(runId)) return;
                if (error?.detail !== 'session_not_found') throw error;

                // Session expired — clear stale pending key and start fresh
                clearPendingMessage(sessionId);
                clearPersistedChatSession();
                flushSync(() => {
                    resetTypingState();
                    setChatSessionId(null);
                    setChatMessages([
                        { role: 'user', content: message },
                        { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question' }
                    ]);
                });
                setChatNotice('Previous session expired. Starting a new session…');
                setTimeout(() => setChatNotice(null), 4000);

                const freshSession = await api.createChatSession(getChatSessionPayload());
                if (!isActiveChatRun(runId)) return;
                activeSessionId = freshSession.session_id;
                setChatSessionId(freshSession.session_id);
                data = await streamForSession(freshSession.session_id, clientMsgId);
            }

            if (!isActiveChatRun(runId)) return;
            if (!data) throw new Error('No response received from server.');

            applyChatResponse(data, message);
            setChatNotice(null);

            // Clear the in-flight marker — response successfully delivered
            clearPendingMessage(activeSessionId);
        } catch (error) {
            if (!isActiveChatRun(runId)) return;
            if (error?.detail === 'session_not_found') {
                clearPersistedChatSession();
                clearPendingMessage(activeSessionId);
                setChatSessionId(null);
                setChatMessages([]);
                setLlmError('The previous chat session expired. Please send your question again.');
            } else {
                // 4xx = definitive server rejection → clear pending
                // 5xx/network = ambiguous → keep pending so visibilitychange can recover
                if (error?.status >= 400 && error?.status < 500) {
                    clearPendingMessage(activeSessionId);
                    setLlmError('Could not continue chat. Please try again.');
                    setChatMessages(prev => prev.filter(item => !(item.role === 'assistant' && item.pending)));
                } else {
                    setLlmError(null);
                    setChatNotice('Connection interrupted. We’ll continue when the app reconnects.');
                    schedulePendingRecovery(activeSessionId, runId, 100);
                }
            }
        } finally {
            if (isActiveChatRun(runId)) setLlmLoading(false);
        }
    }

    async function handleChatStart(firstQuestion) {
        const runId = beginChatRun();
        setLlmLoading(true);
        setLlmError(null);
        setChatNotice(null);
        setChatMessages([]);
        setChatInput('');
        setChatInputVisible(false);
        resetTypingState();
        clearPersistedChatSession();
        try {
            const session = await api.createChatSession(getChatSessionPayload());
            if (!isActiveChatRun(runId)) return;
            setChatSessionId(session.session_id);
            await handleChatSend(session.session_id, firstQuestion, { runId });
        } catch (error) {
            if (!isActiveChatRun(runId)) return;
            setLlmError('Could not start chat. Please try again.');
        } finally {
            if (isActiveChatRun(runId)) setLlmLoading(false);
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
                user_id: USER_ID,
                ...(llmProvider ? { provider: llmProvider } : {})
            };
            const session = await api.createChatSession(sessionPayload);
            const data = await api.sendChatMessage(session.session_id, {
                role: 'user',
                content: query,
                response_format: 'structured',
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
        invalidateChatRuns();
        if (chatSessionId) {
            await api.closeChatSession(chatSessionId).catch(() => null);
        }
        clearPendingMessage(chatSessionId);
        setChatSessionId(null);
        setChatMessages([]);
        setChatInput('');
        setChatInputVisible(false);
        setLlmError(null);
        setChatNotice(null);
        setLlmLoading(false);
        clearRecoveryTimer();
        resetTypingState();
        clearPersistedChatSession();
    }, [chatSessionId, clearPendingMessage, clearPersistedChatSession, clearRecoveryTimer, invalidateChatRuns, resetTypingState]);

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

    const showSearchInterface = currentPage === 'home' || (currentPage === 'chat' && llmAvailable);

    const cleanAnswerText = (answerText) => {
        if (!answerText) return '';
        return answerText.trim();
    };

    const shouldCollapseAnswer = (answerText) => {
        const cleaned = cleanAnswerText(answerText);
        const lineCount = cleaned.split('\n').filter(Boolean).length;
        return cleaned.length > 650 || lineCount > 7;
    };

    const preTokenizeCitations = (answer) => {
        const blocks = [];
        const content = (answer || '').replace(/<citation([^>]*)>([\s\S]*?)<\/citation>/g, (match, attrStr, innerText) => {
            blocks.push({ attrStr, innerText });
            return `@@CITATION_${blocks.length - 1}@@`;
        });
        return { content, citationBlocks: blocks };
    };

    const formatAnswerHtml = (answerText, preloadedCitationBlocks) => {
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
        const citationBlocks = [];

        // Step 0: Use pre-tokenized citation blocks if available (avoids raw <citation> tags
        // appearing mid-render during the typing animation). Otherwise extract inline.
        if (preloadedCitationBlocks && preloadedCitationBlocks.length > 0) {
            citationBlocks.push(...preloadedCitationBlocks);
        } else {
            sanitizedAnswer = sanitizedAnswer.replace(/<citation([^>]*)>([\s\S]*?)<\/citation>/g, (match, attrStr, innerText) => {
                citationBlocks.push({ attrStr, innerText });
                return `@@CITATION_${citationBlocks.length - 1}@@`;
            });
        }

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

        // Step 6: Extract > quote lines (WhatsApp-style citations); trailing (ref) stays inside the quote box
        // Leading whitespace before > is stripped so indented quote lines still match
        sanitizedAnswer = sanitizedAnswer.replace(/^\s*>\s*(.+)$/gm, (match, content) => {
            const refMatch = content.match(/^([\s\S]+?)\s*(\([^)]+\))\s*$/);
            if (refMatch) {
                quoteParts.push(refMatch[1]);
                citationParts.push(refMatch[2]);
                return `__QUOTCITE_${quoteParts.length - 1}_${citationParts.length - 1}__`;
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
        // Runs after all other tokenizations so (ref) from citations is already gone (__QUOTCITE__ token).
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
                if (/^__QUOT(?:CITE)?_\d+/.test(trimmed)) {
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
        html = html.replace(/__QUOTCITE_(\d+)_(\d+)__/g, (match, quoteIdx, citeIdx) => {
            const content = quoteParts[Number(quoteIdx)] || '';
            const citation = citationParts[Number(citeIdx)] || '';
            return `<span class="llm-quote-block">${escapeHtml(content)}<span class="llm-quote-citation">${escapeHtml(citation)}</span></span>`;
        });
        html = html.replace(/__QUOT_(\d+)__/g, (match, idx) => {
            const content = quoteParts[Number(idx)] || '';
            return `<span class="llm-quote-block">${escapeHtml(content)}</span>`;
        });

        const parseCitationAttrs = (attrStr) => {
            const attrs = {};
            const re = /(\w+)="([^"]*)"/g;
            let m;
            while ((m = re.exec(attrStr)) !== null) {
                attrs[m[1]] = m[2].replace(/&quot;/g, '"');
            }
            return attrs;
        };
        const buildCitationLabel = (attrs) => {
            const parts = [];
            if (attrs.granth) parts.push(attrs.granth);
            if (attrs.category === 'Pravachan') {
                if (attrs.pravachankar) parts.push(`by ${attrs.pravachankar}`);
                if (attrs.series) parts.push(attrs.series);
                if (attrs.series_number) parts.push(`Series No. ${attrs.series_number}`);
                if (attrs.volume) parts.push(`Vol ${attrs.volume}`);
                if (attrs.pravachan_number) parts.push(`No. ${attrs.pravachan_number}`);
            } else {
                if (attrs.gatha) parts.push(`Gatha ${attrs.gatha}`);
                if (attrs.shlok) parts.push(`Shlok ${attrs.shlok}`);
                if (attrs.kalash) parts.push(`Kalash ${attrs.kalash}`);
                if (attrs.dohra) parts.push(`Doha ${attrs.dohra}`);
                if (attrs.kavya) parts.push(`Kavya ${attrs.kavya}`);
            }
            if (attrs.page) parts.push(`पृष्ठ ${attrs.page}`);
            if (attrs.date) parts.push(attrs.date);
            return parts.filter(Boolean).join(', ');
        };
        html = html.replace(/@@CITATION_(\d+)@@/g, (match, idx) => {
            const block = citationBlocks[Number(idx)];
            if (!block) return '';
            const attrs = parseCitationAttrs(block.attrStr);
            const escapedText = escapeHtml(block.innerText.trim()).replace(/\r?\n/g, '<br/>');
            const label = buildCitationLabel(attrs);
            const labelHtml = label ? `<span class="llm-quote-citation">${escapeHtml(label)}</span>` : '';
            return `<span class="llm-quote-block">${escapedText}${labelHtml}</span>`;
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

    const buildInlineQuoteLabel = (citation) => {
        if (!citation) return '';
        const parts = [citation.granth];
        if (citation.category === 'Pravachan') {
            if (citation.series) parts.push(citation.series);
            if (citation.volume != null && citation.volume !== '') parts.push(`Vol ${citation.volume}`);
        } else {
            // Granth / Books: author + verse locators
            if (citation.author) parts.push(citation.author);
            const verseLocators = [
                citation.gatha   && `Gatha ${citation.gatha}`,
                citation.shlok   && `Shlok ${citation.shlok}`,
                citation.kalash  && `Kalash ${citation.kalash}`,
                // citations use "dohra", chunk_labels use "doha" — handle both
                (citation.dohra || citation.doha) && `Doha ${citation.dohra || citation.doha}`,
                citation.kavya   && `Kavya ${citation.kavya}`,
                citation.sutra   && `Sutra ${citation.sutra}`,
            ].filter(Boolean);
            parts.push(...verseLocators);
        }
        if (citation.page_number != null && citation.page_number !== '') parts.push(`पृष्ठ ${citation.page_number}`);
        return parts.filter(Boolean).join(', ');
    };

    const resolveChunkQuotes = (text, citations, chunkTexts) => {
        if (!text || !chunkTexts) return text;
        return text.replace(/^(\s*>\s*)\{\{([^}]+)\}\}\s*$/gm, (match, prefix, chunkId) => {
            const chunkData = chunkTexts[chunkId];
            if (!chunkData?.text_content) return match;
            const citationFromResponse = (citations || []).find(c => c.chunk_id === chunkId);
            const label = buildInlineQuoteLabel(citationFromResponse || chunkData);
            return `${prefix}${chunkData.text_content}${label ? ` (${label})` : ''}`;
        });
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

    const buildReferencePdfUrl = (fileUrl, pdfPageNumber, fallbackPageNumber) => {
        const url = String(fileUrl || '').trim();
        const page = Number(pdfPageNumber ?? fallbackPageNumber);
        if (!url) return null;
        if (!Number.isFinite(page) || page <= 0) return url;
        return url.endsWith(`/${page}`) ? url : `${url}/${page}`;
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
            citation.kavya !== undefined && citation.kavya !== null ? `Kavya ${citation.kavya}` : null,
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
            viewPdfUrl: buildReferencePdfUrl(
                citation?.file_url || fallback.url || null,
                citation?.pdf_page_number,
                citation?.page_number
            )
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

                    {currentPage === 'chat' && !llmAvailable && (
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
                                                        <img src="/images/swalakshya.png" className="h-5 w-5 animate-pulse rounded-full mr-2" alt="" />
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
                                            <div className="w-full max-w-4xl space-y-2">
                                                <div className="w-full">
                                                    <SearchableContentWidget />
                                                </div>
                                                <div className="w-full">
                                                    <div className="rounded-lg border border-slate-400 bg-white/95 backdrop-blur-sm shadow-md px-3 py-3 transition-colors focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
                                                        <div className="flex items-center gap-2">
                                                            <div className="relative shrink-0 group">
                                                                <button
                                                                    onClick={handleNewChat}
                                                                    title="New Chat"
                                                                    className="h-8 w-8 flex items-center justify-center rounded-full border border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200 hover:border-sky-400 transition-colors"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                                                </button>
                                                                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 md:block">
                                                                    New chat
                                                                </span>
                                                            </div>
                                                            <div className="flex-grow">
                                                                <SearchBar
                                                                    query={query}
                                                                    setQuery={setQuery}
                                                                    onSearch={() => query.trim() && handleChatStart(query)}
                                                                    language={language}
                                                                />
                                                            </div>
                                                            <button
                                                                onClick={() => query.trim() && handleChatStart(query)}
                                                                disabled={!query.trim()}
                                                                className="bg-sky-600 text-white h-8 w-8 rounded-full border border-sky-700 hover:bg-sky-700 hover:border-sky-800 transition duration-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:border-slate-300 flex items-center justify-center shrink-0"
                                                                aria-label="Send"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                        <div className="mt-1.5 border-t border-slate-100 pt-1.5 flex items-center gap-2 pl-10">
                                                            <ChatFilters
                                                                activeCategories={activeCategories}
                                                                debugMode={debugMode}
                                                                chatContentTypes={chatContentTypes}
                                                                setChatContentTypes={setChatContentTypes}
                                                                chatShastras={chatShastras}
                                                                setChatShastras={setChatShastras}
                                                                allMetadata={allMetadata}
                                                                language={language}
                                                                dropUp={false}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-amber-50/80 border border-amber-200 rounded text-amber-800 text-[11px] leading-relaxed">
                                                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                                    </svg>
                                                    <span>Swalakshya AI Bot uses AI to generate answers, which may sometimes be <strong>inaccurate</strong>. Always refer to the <strong>original scriptures and references</strong> attached to each answer to study authentic content and <strong>stay true to Jinvaani</strong>. Use this bot as a <strong>starting point</strong>, not as a <strong>definitive source</strong>.</span>
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
                                                {chatMessages.map((msg, idx) => {
                                                    const lastUserIdx = chatMessages.reduce((last, m, i) => m.role === 'user' ? i : last, -1);
                                                    const isStreaming = msg.role === 'assistant' && (
                                                        msg.pending || (
                                                            displayedTexts[idx] !== undefined &&
                                                            displayedTexts[idx] !== cleanAnswerText(msg.content)
                                                        )
                                                    );
                                                    return (
                                                    <div key={`${msg.role}-${idx}`}>
                                                        {msg.role === 'user' ? (
                                                            <div ref={idx === lastUserIdx ? latestUserBubbleRef : null} className="flex justify-end">
                                                                <div className="bg-sky-600 shadow-sm rounded-lg rounded-tr-none px-4 py-2.5 max-w-[72%] text-white text-base">
                                                                    {msg.content}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="aibot-assistant-enter pt-2">
                                                                <div className="flex items-start gap-3">
                                                                <img
                                                                    src="/images/swalakshya.png"
                                                                    className={`h-6 w-6 rounded-full shrink-0 mt-0.5 ${isStreaming ? 'animate-pulse' : ''}`}
                                                                    alt=""
                                                                />
                                                                <div className="flex-1">
                                                                {msg.pending ? (
                                                                    <div className="flex items-center text-sm text-slate-600 gap-2">
                                                                        <span>{msg.stageLabel || 'Preparing answer'}</span>
                                                                        <span className="flex items-center text-lime-600" aria-hidden="true">
                                                                            <span className="inline-block animate-bounce">.</span>
                                                                            <span className="inline-block animate-bounce" style={{ animationDelay: '0.15s' }}>.</span>
                                                                            <span className="inline-block animate-bounce" style={{ animationDelay: '0.3s' }}>.</span>
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <div className="flex items-start justify-between gap-3 mb-3 max-w-3xl">
                                                                            <div>
                                                                                <div className="text-sm font-bold uppercase tracking-[0.12em] text-slate-900">Answer</div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="max-w-3xl">
                                                                            <div className={`text-slate-900 leading-relaxed text-base ${displayedTexts[idx] === cleanAnswerText(msg.content) && shouldCollapseAnswer(msg.content) && expandedAnswers[idx] === false ? 'max-h-72 overflow-hidden' : ''}`}
                                                                                dangerouslySetInnerHTML={{ __html: formatAnswerHtml(
                                                                                    resolveChunkQuotes(
                                                                                        displayedTexts[idx] !== undefined ? displayedTexts[idx] : msg.content || '',
                                                                                        msg.citations,
                                                                                        chunkTextsCache
                                                                                    ),
                                                                                    msg.citationBlocks
                                                                                )}} />
                                                                            {displayedTexts[idx] === cleanAnswerText(msg.content) && shouldCollapseAnswer(msg.content) && (
                                                                                <button
                                                                                    onClick={() => setExpandedAnswers(prev => ({ ...prev, [idx]: prev[idx] === false }))}
                                                                                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:text-sky-800 transition-colors"
                                                                                >
                                                                                    {expandedAnswers[idx] === false ? 'Show more' : 'Show less'}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        {displayedTexts[idx] === cleanAnswerText(msg.content) && msg.content && (
                                                                            <div className="mt-4 w-full flex justify-end">
                                                                                <CopyAnswerButton text={cleanAnswerText(msg.content)} />
                                                                            </div>
                                                                        )}
                                                                        {displayedTexts[idx] === cleanAnswerText(msg.content) && msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                                                                            <div className="mt-8 w-full rounded-md border border-sky-200 bg-sky-50 p-4">
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
                                                                        {displayedTexts[idx] === cleanAnswerText(msg.content) && msg.references && msg.references.length > 0 && (
                                                                            <div className="mt-5 w-full rounded-md border border-sky-200 bg-sky-50 p-4">
                                                                                <h4 className="text-xs font-bold uppercase tracking-wide text-sky-800 mb-3">📖 References</h4>
                                                                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                                                                    {msg.references.map((ref, refIdx) => {
                                                                                        const citation = (msg.citations || []).find(c => c.reference === ref) || msg.citations?.[refIdx];
                                                                                        const card = getAibotReferenceCardData(citation, ref);
                                                                                        const handleCardActivate = () => {
                                                                                            if (card.readChunkId) {
                                                                                                handleExpand(card.readChunkId);
                                                                                            } else if (card.viewPdfUrl) {
                                                                                                window.open(card.viewPdfUrl, '_blank', 'noopener,noreferrer');
                                                                                            }
                                                                                        };
                                                                                        const isCardInteractive = Boolean(card.readChunkId || card.viewPdfUrl);
                                                                                        return (
                                                                                            <div
                                                                                                key={`${ref}-${refIdx}`}
                                                                                                onClick={isCardInteractive ? handleCardActivate : undefined}
                                                                                                onKeyDown={isCardInteractive ? (event) => {
                                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                                        event.preventDefault();
                                                                                                        handleCardActivate();
                                                                                                    }
                                                                                                } : undefined}
                                                                                                role={isCardInteractive ? 'button' : undefined}
                                                                                                tabIndex={isCardInteractive ? 0 : undefined}
                                                                                                className={`flex flex-col justify-between border rounded p-3 text-sm transition-shadow ${card.cardClassName} ${isCardInteractive ? 'cursor-pointer hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-200' : ''}`}
                                                                                            >
                                                                                                <div className="mb-3">
                                                                                                    <div className="mb-2 flex items-start justify-between gap-2">
                                                                                                        <span className={`inline-block text-xs font-bold rounded px-1.5 py-0.5 ${card.numberClassName}`}>{refIdx + 1}</span>
                                                                                                        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${card.badgeClassName}`}>
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
                                                                                                        <button onClick={(event) => {
                                                                                                            event.stopPropagation();
                                                                                                            handleExpand(card.readChunkId);
                                                                                                        }}
                                                                                                            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded px-2 py-1 transition-colors">
                                                                                                            Expand
                                                                                                        </button>
                                                                                                    )}
                                                                                                    {card.viewPdfUrl && (
                                                                                                        <a href={card.viewPdfUrl} target="_blank" rel="noopener noreferrer"
                                                                                                            onClick={(event) => event.stopPropagation()}
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
                                                                        {displayedTexts[idx] === cleanAnswerText(msg.content) && msg.content && msg.question && (
                                                                            <FeedbackButtons
                                                                                requestId={msg.tool_trace_id}
                                                                                question={msg.question || ''}
                                                                                answer={msg.rawAnswer || cleanAnswerText(msg.content)}
                                                                                references={msg.references}
                                                                                citations={msg.citations}
                                                                                followUpQuestions={msg.follow_up_questions}
                                                                            />
                                                                        )}
                                                                    </>
                                                                )}
                                                                </div>
                                                                </div>{/* flex items-start gap-3 */}
                                                            </div>
                                                        )}
                                                    </div>
                                                    );
                                                })}
                                                {llmError && <div className="text-red-600 text-sm">{llmError}</div>}
                                                <div ref={messagesEndRef} />
                                                {/* Spacer while loading so the new user bubble can always reach the top of the viewport */}
                                                {llmLoading && <div style={{ height: '70vh', flexShrink: 0 }} aria-hidden="true" />}
                                            </div>

                                            {/* Scroll-to-bottom arrow */}
                                            {showScrollDown && (
                                                <button
                                                    onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                                                    className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 h-9 w-9 rounded-full bg-sky-600 text-white shadow-lg flex items-center justify-center hover:bg-sky-700 transition-colors"
                                                    aria-label="Scroll to bottom"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>
                                            )}

                                            {/* Sticky bottom input */}
                                            <div className="sticky bottom-0 mt-auto pt-3 pb-4 shrink-0" style={{ backgroundColor: '#f0f4f9' }}>
                                                {chatNotice && (
                                                    <div className="flex justify-center mb-2">
                                                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1 animate-fade-in">{chatNotice}</span>
                                                    </div>
                                                )}
                                                <div className="rounded-lg border border-slate-400 bg-white/95 backdrop-blur-sm shadow-md px-3 py-3 transition-colors focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative shrink-0 group">
                                                            <button
                                                                onClick={handleNewChat}
                                                                title="New Chat"
                                                                className="h-8 w-8 flex items-center justify-center rounded-full border border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200 hover:border-sky-400 transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                                            </button>
                                                            <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 md:block">
                                                                New chat
                                                            </span>
                                                        </div>
                                                        <div className="flex-grow">
                                                            <SearchBar
                                                                query={chatInput}
                                                                setQuery={setChatInput}
                                                                onSearch={() => chatInput.trim() && !llmLoading && handleChatSend(chatSessionId, chatInput)}
                                                                language={language}
                                                                disabled={llmLoading || hasPendingChatMessage}
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => handleChatSend(chatSessionId, chatInput)}
                                                            disabled={llmLoading || hasPendingChatMessage || !chatInput.trim()}
                                                            className="bg-sky-600 text-white h-8 w-8 rounded-full border border-sky-700 hover:bg-sky-700 hover:border-sky-800 transition duration-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:border-slate-300 flex items-center justify-center shrink-0"
                                                            aria-label="Send"
                                                        >
                                                            {llmLoading ? <Spinner /> : (
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    </div>
                                                    <div className="mt-1.5 border-t border-slate-100 pt-1.5 flex items-center gap-2 pl-10">
                                                        <ChatFilters
                                                            activeCategories={activeCategories}
                                                            debugMode={debugMode}
                                                            chatContentTypes={chatContentTypes}
                                                            setChatContentTypes={setChatContentTypes}
                                                            chatShastras={chatShastras}
                                                            setChatShastras={setChatShastras}
                                                            allMetadata={allMetadata}
                                                            language={language}
                                                            dropUp={true}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-2.5 px-3.5 py-2.5 mt-2 bg-amber-50/80 border border-amber-200 rounded text-amber-800 text-[11px] leading-relaxed">
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
                <Route path="/admin" element={<AdminRoute />} />
            </Routes>
        </Router>
    );
}
