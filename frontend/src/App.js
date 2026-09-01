import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
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
import { FeedbackButtons } from './components/AibotFeedback';
import About from './components/About';
import WhatsNew from './components/WhatsNew';
import UsageGuide from './components/UsageGuide';
import DeveloperAPI from './components/DeveloperAPI';
import SearchIndex from './components/SearchIndex';
import UIEval from './components/eval/UIEval';
import SearchableContentWidget from './components/SearchableContentWidget';
import ChatComposer from './components/chat/ChatComposer';
import StatsStrip from './components/chat/StatsStrip';
import AiDisclaimer from './components/chat/AiDisclaimer';
import { Spinner, ChevronUpIcon, ChevronDownIcon, ExpandIcon, PdfIcon } from './components/SharedComponents';
import { ChevronDown, Sparkles, AlertTriangle, Mail, Home, PenLine, Check } from 'lucide-react';
import clipboardEmoji from './assets/emoji/clipboard.svg';
import bulbEmoji from './assets/emoji/bulb.svg';
import documentEmoji from './assets/emoji/document.svg';
import { CATEGORY_EMOJI_SRC } from './components/chat/categoryEmoji';
import { Modal } from './components/ui';

// Import API service
import { api } from './services/api';
import { getRandomSuggestedQueriesByLanguage } from './utils/suggestedQueries';
import { copyToClipboard } from './utils/shareUtils';

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


// --- CITATION HELPERS (shared by the on-screen HTML renderer and the plain-text share/copy path) ---
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

// --- SHARE ANSWER BUTTONS ---
// Splits "> quote (citation)" into "> quote\n> (citation)" so WhatsApp keeps the
// citation inside the same quote block but on its own line (every line needs its own ">").
const splitCitationLines = (text) => {
    if (!text) return text;
    return text.replace(/^>[ \t]*(?=\S)([^\n]+?)[ \t]*(\([^)]+\))[ \t]*$/gm, (match, quote, citation) => `> ${quote}\n> ${citation}`);
};

// Resolves @@CITATION_n@@ tokens (from citationBlocks, used when ENABLE_FULL_CHUNKS_IN_CITATIONS
// is on) into WhatsApp-style ">" quote lines — every line of the quote text gets its own ">",
// plus a trailing "> (label)" citation line.
const resolveCitationTokensToText = (text, citationBlocks) => {
    if (!text || !citationBlocks || !citationBlocks.length) return text;
    return text.replace(/@@CITATION_(\d+)@@/g, (match, idx) => {
        const block = citationBlocks[Number(idx)];
        if (!block) return '';
        const attrs = parseCitationAttrs(block.attrStr);
        const label = buildCitationLabel(attrs);
        const quoteLines = block.innerText.trim().split(/\r?\n/)
            .filter(line => line.trim() !== '')
            .map(line => `> ${line}`);
        if (label) quoteLines.push(`> (${label})`);
        return quoteLines.join('\n');
    });
};

const SHARE_FOOTER = '--\n*Get your Adhyatmic questions answered on Swalakshya:* https://chat.swalakshya.me/';

const ShareAnswerButtons = ({ question, answer, citationBlocks }) => {
    const [copied, setCopied] = useState(false);
    const resolvedAnswer = resolveCitationTokensToText(answer, citationBlocks);
    const formattedAnswer = splitCitationLines(resolvedAnswer);
    const shareText = `${question ? `*Question: ${question}*\n\n*Answer:*\n${formattedAnswer}` : formattedAnswer}\n\n${SHARE_FOOTER}`;

    const handleCopy = async () => {
        const success = await copyToClipboard(shareText);
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleWhatsAppShare = () => {
        const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleCopy}
                className="btn btn-secondary flex items-center gap-1.5 text-xs py-1 px-2"
                title="Copy answer"
            >
                {copied ? (
                    <>
                        <Check size={14} style={{ color: 'var(--color-success)' }} />
                        <span style={{ color: 'var(--color-success)' }}>Copied to clipboard</span>
                    </>
                ) : (
                    <>
                        <img src={clipboardEmoji} alt="" className="w-3.5 h-3.5" />
                        <span>Copy</span>
                    </>
                )}
            </button>
            <button
                onClick={handleWhatsAppShare}
                className="btn btn-secondary flex items-center gap-1.5 text-xs py-1 px-2"
                title="Share on WhatsApp"
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#25D366">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.892.526 3.66 1.438 5.166L2 22l4.955-1.4A9.94 9.94 0 0012.001 22C17.523 22 22 17.522 22 12S17.523 2 12.001 2zm0 18.2a8.19 8.19 0 01-4.19-1.147l-.3-.178-3.11.878.83-3.03-.196-.31A8.176 8.176 0 013.8 12c0-4.522 3.679-8.2 8.201-8.2 4.521 0 8.199 3.678 8.199 8.2 0 4.522-3.678 8.2-8.199 8.2z"/>
                </svg>
                <span>WhatsApp</span>
            </button>
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
    // True while the Pravachan/Granth filter modal (SearchFilters) is open — used to
    // hide the mobile FABs below so they don't collide with the modal's Apply button.
    const [filterModalOpen, setFilterModalOpen] = useState(false);
    const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
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
    // Tracks the localId of the turn currently being streamed live in handleChatSend.
    // recoverPendingMessage checks this before opening a competing stream for the same turn.
    const activeStreamLocalIdRef = useRef(null);
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

    const ensureRecoveredQuestion = useCallback((messages, question, localId) => {
        if (!question) return messages;
        // Already present — nothing to do.
        const existing = messages.find(m => m.role === 'user' && m.localId === localId);
        if (existing) return messages;
        // Insert the user bubble immediately before the pending assistant for this turn
        // so the order is always [user, assistant_pending], not [assistant_pending, user].
        const userMsg = { role: 'user', content: question, localId };
        const pendingIdx = localId ? messages.findIndex(m => m.localId === localId && m.pending) : -1;
        if (pendingIdx !== -1) {
            const next = [...messages];
            next.splice(pendingIdx, 0, userMsg);
            return next;
        }
        return [...messages, userMsg];
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

        const localId = pending.localId ?? null;

        // If the live stream in handleChatSend already owns this turn, don't compete.
        if (localId && activeStreamLocalIdRef.current === localId) return;

        setChatMessages(prev => {
            const withQuestion = ensureRecoveredQuestion(prev, pending.question, localId);
            const hasPending = withQuestion.some(m => m.role === 'assistant' && m.pending && (!localId || m.localId === localId));
            if (hasPending) return withQuestion;
            return [...withQuestion, { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question', localId }];
        });

        try {
            const jobStatus = await api.getChatMessageResult(sessionId, pending.messageId);
            if (!isActiveChatRun(runId)) return;

            if (jobStatus.status === 'done') {
                const { status: _s, message_id: _m, ...result } = jobStatus;
                applyChatResponse(result, pending.question || null, localId);
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
                            const idx = localId
                                ? updated.findIndex(m => m.localId === localId && m.pending)
                                : updated.findIndex(m => m.role === 'assistant' && m.pending);
                            if (idx !== -1) updated[idx] = { ...updated[idx], stage: event.stage, stageLabel: event.label };
                            return updated;
                        });
                    },
                    onEventId: saveCursor,
                });
                if (!isActiveChatRun(runId)) return;
                if (data) {
                    applyChatResponse(data, pending.question || null, localId);
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

    // Typing effect: reveal each new assistant message character by character
    useEffect(() => {
        chatMessages.forEach((msg, idx) => {
            const key = msg.localId ?? idx;
            if (msg.role === 'assistant' && !msg.pending && msg.content &&
                displayedTexts[key] === undefined && !typingIntervalsRef.current[key]) {
                let charIdx = 0;
                const fullText = cleanAnswerText(msg.content);
                typingIntervalsRef.current[key] = setInterval(() => {
                    charIdx += 4;
                    if (charIdx >= fullText.length) {
                        charIdx = fullText.length;
                        clearInterval(typingIntervalsRef.current[key]);
                        delete typingIntervalsRef.current[key];
                    }
                    setDisplayedTexts(prev => ({ ...prev, [key]: fullText.slice(0, charIdx) }));
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
            setAppName(cfg.app_name || 'swalakshya');
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
                                acc[msg.localId ?? idx] = cleanAnswerText(msg.content);
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
            app: appName,
            ...(llmProvider ? { provider: llmProvider } : {})
        };
    }, [language, llmProvider, appName]);

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
    function applyChatResponse(data, question, localId = null) {
        setChatMessages(prev => {
            const { content, citationBlocks } = preTokenizeCitations(data.answer || '');
            const updated = [...prev];
            const idx = localId
                ? updated.findIndex(item => item.localId === localId && item.pending)
                : updated.findIndex(item => item.role === 'assistant' && item.pending);
            const msg = {
                role: 'assistant',
                localId: localId ?? undefined,
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
            if (localId) return updated; // turn already resolved — idempotent no-op
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
        // Stable local ID for this turn — ties the user bubble and assistant bubble together
        // across re-renders, recovery, and array shifts. Never sent to the server.
        const localId = crypto.randomUUID();
        activeStreamLocalIdRef.current = localId; // claim ownership of this turn
        setChatMessages(prev => [
            ...prev,
            { role: 'user', content: message, localId },
            { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question', localId }
        ]);
        setChatInput('');
        setChatInputVisible(false);

        const onStageEvent = (event) => {
            if (!isActiveChatRun(runId) || event?.type !== 'stage') return;
            setChatMessages(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(item => item.localId === localId && item.pending);
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
                try {
                    localStorage.setItem(pendingKey, JSON.stringify({
                        messageId: clientMsgId,
                        lastEventId,
                        question: message,
                        localId,
                    }));
                } catch {}
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
                        { role: 'user', content: message, localId },
                        { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question', localId }
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

            applyChatResponse(data, message, localId);
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
            if (activeStreamLocalIdRef.current === localId) activeStreamLocalIdRef.current = null;
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
                app: appName,
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
        const actionLabelParts = [];

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

        // Step 1.5: Recognize the closed set of known interactive action placeholders.
        // Must run AFTER italic extraction (see note above) so this token's own underscores
        // don't get mistaken for _italic_ markers. This is intentionally NOT a general
        // link/markup mechanism: the action (e.g. "feedback_button") is a fixed, hardcoded
        // identifier resolved to one specific wired-up click handler below — only the visible
        // label text is free-form. LLM-generated or indexed-document text can never inject an
        // arbitrary clickable destination or URL here, only decide what a known button says.
        sanitizedAnswer = sanitizedAnswer.replace(/\[feedback_button:([^\]]+)\]/g, (match, label) => {
            actionLabelParts.push(label);
            return `__ACTION_FEEDBACK_${actionLabelParts.length - 1}__`;
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

        // Collapse runs of 3+ newlines down to one blank line (reduces excessive gaps from
        // verbose LLM output) while preserving a single intentional blank-line paragraph break.
        text = text.replace(/\n{3,}/g, '\n\n');

        // Split into lines; insert spacing before headings and citation blocks
        const lines = text.split('\n');
        const segments = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (segments.length > 0) {
                const lastSegment = segments[segments.length - 1];
                // Blank line before headings (skip if one is already there from the source text)
                if (/^__HEADING_BOLD_\d+__$/.test(trimmed) && lastSegment !== '') {
                    segments.push('');
                }
                // Small-gap line before citation blocks (grey quote lines)
                if (/^__QUOT(?:CITE)?_\d+/.test(trimmed) && lastSegment !== '') {
                    segments.push('<span style="display:block;height:0"></span>');
                }
            }
            segments.push(line);
        }

        let html = segments.join('<br/>');

        // A blank line in the source (paragraph break) becomes an empty segment between
        // two <br/>s, i.e. a full blank TEXT LINE (~1 line-height, ~26px) — much taller
        // than intended just to separate paragraphs. Replace that specific pattern with a
        // smaller fixed-height spacer instead of a whole empty line of text.
        html = html.replace(/<br\/><br\/>/g, '<span style="display:block;height:0.5rem"></span>');

        // __PAREN__ first so any inner tokens (__BOLD__, __ITAL__, etc.) are resolved by subsequent steps
        html = html.replace(/__PAREN_(\d+)__/g, (match, idx) => {
            const content = parenParts[Number(idx)] || '';
            return `<span style="font-size:0.82em">(${escapeHtml(content)})</span>`;
        });

        html = html.replace(/__HEADING_BOLD_(\d+)__/g, (match, idx) => {
            const content = headingParts[Number(idx)] || '';
            return `<strong>${escapeHtml(content)}</strong><hr class="llm-bold-separator"/>`;
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

        html = html.replace(/@@CITATION_(\d+)@@/g, (match, idx) => {
            const block = citationBlocks[Number(idx)];
            if (!block) return '';
            const attrs = parseCitationAttrs(block.attrStr);
            const escapedText = escapeHtml(block.innerText.trim()).replace(/\r?\n/g, '<br/>');
            const label = buildCitationLabel(attrs);
            const marker = buildQuoteMetaMarker({ category: attrs.category, file_url: attrs.file_url, pdf_page_number: attrs.pdf_page_number, page_number: attrs.page });
            const inner = `${escapeHtml(label)}${marker}`;
            const labelHtml = (label || marker) ? `<span class="llm-quote-citation">${inner}</span>` : '';
            return `<span class="llm-quote-block">${escapedText}${labelHtml}</span>`;
        });
        html = html.replace(/__CITE_(\d+)__/g, (match, idx) => {
            const content = citationParts[Number(idx)] || '';
            const escaped = escapeHtml(content);
            return `<div style="display:block;text-align:right;margin-top:0.1rem"><sub style="font-size:0.65em;color:var(--color-ink-muted);font-style:italic">${escaped}</sub></div>`;
        });
        html = html.replace(/__CODE_(\d+)__/g, (match, idx) => {
            const content = codeParts[Number(idx)] || '';
            return `<span class="llm-code">${escapeHtml(content)}</span>`;
        });
        html = html.replace(/__ACTION_FEEDBACK_(\d+)__/g, (match, idx) => {
            const label = actionLabelParts[Number(idx)] || 'Feedback';
            return `<button type="button" data-app-action="feedback" class="text-brand underline decoration-brand underline-offset-2 hover:text-brand-hover transition-colors">${escapeHtml(label)}</button>`;
        });

        // Change #1: citation divs are display:block so they create their own line break;
        // remove the extra <br/> the segment join places immediately after </div> to avoid double-spacing.
        html = html.replace(/<\/div><br\/>/g, '</div>');

        // Resolve detail-prompt break markers inserted before tokenization
        html = html.replace(/@@BREAK@@/g, '<br/>');

        // Resolve QPDF markers (see buildQuoteMetaMarker) into "| <emoji> Category: X | <emoji> View PDF",
        // now that escaping is done — the one place both citation paths (embedded
        // <citation> tags, and {{chunk_id}} quotes) end up rendered.
        html = html.replace(/\[\[QPDF:([^:\]]*):([^\]]*)\]\]/g, (match, category, encodedUrl) => {
            const parts = [];
            if (category) {
                const meta = getCitationCategoryMeta(category);
                const emojiSrc = CATEGORY_EMOJI_SRC[category];
                const emojiHtml = emojiSrc ? `<img src="${emojiSrc}" alt="" class="llm-inline-emoji" />` : '';
                parts.push(`<span class="llm-quote-meta-item">${emojiHtml}Category: ${escapeHtml(meta.label)}</span>`);
            }
            if (encodedUrl) {
                const pdfUrl = decodeURIComponent(encodedUrl);
                parts.push(`<a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer" class="llm-quote-meta-item llm-view-pdf-link"><img src="${documentEmoji}" alt="" class="llm-inline-emoji" />View PDF</a>`);
            }
            return parts.length ? ` | ${parts.join(' | ')}` : '';
        });

        return html;
    };

    // Delegated click handler for the closed set of action buttons formatAnswerHtml renders
    // (e.g. data-app-action="feedback"). Needed because dangerouslySetInnerHTML content can't
    // carry React event handlers directly.
    const handleAnswerActionClick = (event) => {
        const target = event.target.closest('[data-app-action]');
        if (!target) return;
        const action = target.getAttribute('data-app-action');
        if (action === 'feedback') {
            setCurrentPage('feedback');
        }
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

    // [[QPDF:category:url-encoded-pdf-url]] -- an inert marker carrying a quote's
    // category + PDF link through the whole tokenize/escape pipeline, resolved into a
    // real badge + "View PDF" link at the very end of formatAnswerHtml. Used by both
    // citation paths (this chunk-quote path, and the <citation> tag path in
    // formatAnswerHtml) so there's one single place that turns "category + url" into
    // markup. Bracket-delimited rather than space-delimited -- a space-based version of
    // this marker was silently losing its surrounding spaces somewhere in the pipeline
    // (never root-caused), so this uses characters no realistic answer text or
    // encodeURIComponent output can produce, no whitespace involved at all.
    const buildQuoteMetaMarker = (source) => {
        const pdfUrl = buildReferencePdfUrl(source?.file_url, source?.pdf_page_number, source?.page_number);
        if (!source?.category && !pdfUrl) return '';
        return `[[QPDF:${source?.category || ''}:${pdfUrl ? encodeURIComponent(pdfUrl) : ''}]]`;
    };

    const resolveChunkQuotes = (text, citations, chunkTexts) => {
        if (!text || !chunkTexts) return text;
        return text.replace(/^(\s*>\s*)\{\{([^}]+)\}\}\s*$/gm, (match, prefix, chunkId) => {
            const chunkData = chunkTexts[chunkId];
            if (!chunkData?.text_content) return match;
            const source = (citations || []).find(c => c.chunk_id === chunkId) || chunkData;
            const label = buildInlineQuoteLabel(source);
            const marker = buildQuoteMetaMarker(source);
            const inner = [label, marker].filter(Boolean).join('');
            return `${prefix}${chunkData.text_content}${inner ? ` (${inner})` : ''}`;
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

    // Each content category gets a distinct token-driven badge variant (not a literal
    // color), so this stays correct under any of the 6 candidate palettes / dark mode.
    // Used to badge inline quote citations — see the QPDF marker in formatAnswerHtml.
    const getCitationCategoryMeta = (category) => {
        switch (category) {
            case 'Pravachan':
                return { label: 'Pravachan', variant: 'info' };
            case 'Granth':
                return { label: 'Granth', variant: 'brand' };
            case 'Books':
                return { label: 'Books', variant: 'success' };
            default:
                return { label: 'Reference', variant: 'neutral' };
        }
    };

    return (
        <div style={{ backgroundColor: 'var(--color-bg)', '--bg-card': 'var(--color-surface)', '--bg-surface': 'var(--color-bg)' }} className="text-ink min-h-screen font-sans flex items-start">
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
            <Sidebar
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                onNewChat={handleNewChat}
                mobileOpen={sidebarMobileOpen}
                onCloseMobile={() => setSidebarMobileOpen(false)}
            />

            <div className="flex-1 flex flex-col min-w-0">
                <TopBar
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    onOpenMobileSidebar={() => setSidebarMobileOpen(true)}
                />

                <div className="p-4 md:p-5">
                <div className="max-w-[1080px] mx-auto">

                    {currentPage === 'chat' && !llmAvailable && (
                        <main>
                            <div className="text-center py-16">
                                <p className="text-ink-muted text-lg">AI Service is unavailable right now.</p>
                            </div>
                        </main>
                    )}

                    {showSearchInterface && (
                        <main>

                            {/* ── SEARCH MODE ── */}
                            {!isChatMode && (
                                <>
                                    <SearchableContentWidget />
                                    <div className="card p-3 shadow-sm mb-4">
                                        <div className="flex items-end gap-2">
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
                                                className="btn btn-primary h-8 px-4 py-0 text-sm whitespace-nowrap shrink-0"
                                            >
                                                {isLoading ? <Spinner /> : 'Search'}
                                            </button>
                                        </div>
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
                                                className="flex items-center text-brand font-semibold hover:text-brand-hover text-sm"
                                                aria-label="Show search tips"
                                            >
                                                <ExpandIcon />
                                                Tips for writing good queries
                                            </button>
                                        </div>
                                        {showFilters && (
                                            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
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
                                                        onFilterModalOpenChange={setFilterModalOpen}
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
                                        <div className="card p-4 shadow-sm mb-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="text-lg font-semibold text-ink">Answer</h3>
                                                {llmLoading && (
                                                    <div className="flex items-center text-sm text-ink-muted">
                                                        <img src="/images/swalakshya.png" className="h-5 w-5 animate-pulse rounded-full mr-2" alt="" />
                                                        Generating...
                                                    </div>
                                                )}
                                            </div>
                                            {llmError && <div className="text-sm" style={{ color: 'var(--color-danger)' }}>{llmError}</div>}
                                            {(llmAnswer || llmReferences.length > 0) && (
                                                <div className="llm-answer-scroll">
                                                    {llmAnswer && (
                                                        <div className="text-ink leading-relaxed text-base"
                                                            onClick={handleAnswerActionClick}
                                                            dangerouslySetInnerHTML={{ __html: formatAnswerHtml(llmAnswer) }} />
                                                    )}
                                                    {llmReferences.length > 0 && (
                                                        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                                                            <h4 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-2">References</h4>
                                                            <div className="space-y-2">
                                                                {llmReferences.map((ref, idx) => {
                                                                    const { text, url } = parseReference(ref);
                                                                    const citation = llmCitations.find(c => c.reference === ref);
                                                                    return (
                                                                        <div key={`${ref}-${idx}`} className="flex items-center justify-between gap-3 text-sm text-ink">
                                                                            <span className="flex-1">{text || ref}</span>
                                                                            <div className="flex items-center gap-2 whitespace-nowrap">
                                                                                {citation && (
                                                                                    <button onClick={() => handleExpand(citation.chunk_id)}
                                                                                        className="text-ink-muted hover:text-ink font-medium underline underline-offset-2">
                                                                                        View text
                                                                                    </button>
                                                                                )}
                                                                                {url && (
                                                                                    <a href={url} target="_blank" rel="noopener noreferrer"
                                                                                        className="btn btn-secondary inline-flex items-center gap-1 text-sm py-1 px-2"
                                                                                        style={{ color: 'var(--color-danger)' }}>
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
                                            <div className="card overflow-hidden">
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
                                                            <div className="text-center py-8 text-sm text-ink-muted">No similar documents found.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {homeMode && !isLoading && !searchData && !similarDocumentsData && (
                                        <div className="mt-5">
                                            <p className="text-xs text-ink-muted uppercase tracking-wider mb-2.5 font-medium">Try searching for</p>
                                            <div className="flex flex-wrap gap-2">
                                                {suggestedQueries.map(term => (
                                                    <button key={term} onClick={() => handleSuggestionClick(term)}
                                                        className="suggestion-chip px-3 py-1 text-sm rounded transition-colors">
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
                                                <div className="text-center mb-12">
                                                    <h1 className="text-4xl font-bold text-ink tracking-tight">Swalakshya AI</h1>
                                                    <p className="mt-2 text-ink-muted max-w-xl mx-auto">Get your questions answered through authentic Jain Scriptures and teachings of Pujya Gurudevshri Kanji Swami</p>
                                                </div>
                                                <ChatComposer
                                                    query={query}
                                                    setQuery={setQuery}
                                                    onSend={() => query.trim() && handleChatStart(query)}
                                                    language={language}
                                                    activeCategories={activeCategories}
                                                    debugMode={debugMode}
                                                    chatContentTypes={chatContentTypes}
                                                    setChatContentTypes={setChatContentTypes}
                                                    showDisclaimer={false}
                                                />
                                                <div className="w-full pt-10">
                                                    <div className="flex items-center gap-3 mb-4">
                                                        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
                                                        <p className="text-xs text-ink-muted uppercase tracking-wider font-medium whitespace-nowrap">Try asking</p>
                                                        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 justify-center">
                                                        {suggestedQueries.map(term => (
                                                            <button key={term} onClick={() => handleChatStart(term)}
                                                                className="suggestion-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors">
                                                                <Sparkles size={13} style={{ color: 'var(--color-brand)' }} />
                                                                {term}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="w-full pt-8">
                                                    <StatsStrip />
                                                </div>
                                                <div className="w-full pt-1">
                                                    <AiDisclaimer />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Active chat state */}
                                    {(chatMessages.length > 0 || llmLoading) && (
                                        <div className="flex flex-col max-w-4xl mx-auto w-full min-h-[calc(100vh-240px)]">
                                            {/* Messages */}
                                            <div className="flex-1 py-4 space-y-6">
                                                {(() => {
                                                    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
                                                    return chatMessages.map((msg, idx) => {
                                                    const key = msg.localId ?? idx;
                                                    const isLastUser = msg.role === 'user' && msg === lastUserMsg;
                                                    const isStreaming = msg.role === 'assistant' && (
                                                        msg.pending || (
                                                            displayedTexts[key] !== undefined &&
                                                            displayedTexts[key] !== cleanAnswerText(msg.content)
                                                        )
                                                    );
                                                    return (
                                                    <div key={msg.localId ? `${msg.role}-${msg.localId}` : `${msg.role}-${idx}`}>
                                                        {msg.role === 'user' ? (
                                                            <div ref={isLastUser ? latestUserBubbleRef : null} className="flex justify-end">
                                                                <div className="shadow-sm rounded-lg rounded-tr-none px-4 py-2.5 max-w-[72%] text-white text-base" style={{ backgroundColor: 'var(--color-brand)' }}>
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
                                                                    <div className="flex items-center text-sm text-ink-muted gap-2">
                                                                        <span>{msg.stageLabel || 'Preparing answer'}</span>
                                                                        <span className="flex items-center text-brand" aria-hidden="true">
                                                                            <span className="inline-block animate-bounce">.</span>
                                                                            <span className="inline-block animate-bounce" style={{ animationDelay: '0.15s' }}>.</span>
                                                                            <span className="inline-block animate-bounce" style={{ animationDelay: '0.3s' }}>.</span>
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <div className="flex items-start justify-between gap-3 mb-3 max-w-3xl">
                                                                            <div>
                                                                                <div className="text-sm font-bold uppercase tracking-[0.12em] text-ink">Answer</div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="max-w-3xl">
                                                                            <div className={`text-ink leading-relaxed text-base ${displayedTexts[key] === cleanAnswerText(msg.content) && shouldCollapseAnswer(msg.content) && expandedAnswers[key] === false ? 'max-h-72 overflow-hidden' : ''}`}
                                                                                onClick={handleAnswerActionClick}
                                                                                dangerouslySetInnerHTML={{ __html: formatAnswerHtml(
                                                                                    resolveChunkQuotes(
                                                                                        displayedTexts[key] !== undefined ? displayedTexts[key] : msg.content || '',
                                                                                        msg.citations,
                                                                                        chunkTextsCache
                                                                                    ),
                                                                                    msg.citationBlocks
                                                                                )}} />
                                                                            {displayedTexts[key] === cleanAnswerText(msg.content) && shouldCollapseAnswer(msg.content) && (
                                                                                <button
                                                                                    onClick={() => setExpandedAnswers(prev => ({ ...prev, [key]: prev[key] === false }))}
                                                                                    className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-hover transition-colors"
                                                                                >
                                                                                    {expandedAnswers[key] === false ? 'Show more' : 'Show less'}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        {displayedTexts[key] === cleanAnswerText(msg.content) && msg.content && (
                                                                            <div className="mt-2 w-full max-w-3xl flex justify-end">
                                                                                <ShareAnswerButtons question={chatMessages[idx - 1]?.content} answer={cleanAnswerText(msg.content)} citationBlocks={msg.citationBlocks} />
                                                                            </div>
                                                                        )}
                                                                        {displayedTexts[key] === cleanAnswerText(msg.content) && msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                                                                            <div className="mt-6 w-full max-w-3xl">
                                                                                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2.5 text-ink-muted">
                                                                                    <img src={bulbEmoji} alt="" className="w-3.5 h-3.5" />
                                                                                    Suggested Follow Up Questions
                                                                                </p>
                                                                                <div className="flex flex-wrap gap-2">
                                                                                    {msg.follow_up_questions.map((question, questionIdx) => (
                                                                                        <button
                                                                                            key={`${idx}-follow-up-${questionIdx}`}
                                                                                            onClick={() => handleChatSend(chatSessionId, question)}
                                                                                            disabled={llmLoading || !chatSessionId}
                                                                                            className="suggestion-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                                        >
                                                                                            <Sparkles size={13} style={{ color: 'var(--color-brand)' }} />
                                                                                            {question}
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {displayedTexts[key] === cleanAnswerText(msg.content) && msg.content && msg.question && (
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
                                                });
                                                })()}
                                                {llmError && <div className="text-sm" style={{ color: 'var(--color-danger)' }}>{llmError}</div>}
                                                <div ref={messagesEndRef} />
                                                {/* Spacer while loading so the new user bubble can always reach the top of the viewport */}
                                                {llmLoading && <div style={{ height: '70vh', flexShrink: 0 }} aria-hidden="true" />}
                                            </div>

                                            {/* Scroll-to-bottom arrow */}
                                            {showScrollDown && (
                                                <button
                                                    onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                                                    className="btn btn-primary fixed bottom-28 left-1/2 -translate-x-1/2 z-40 h-9 w-9 rounded-full p-0 shadow-lg"
                                                    aria-label="Scroll to bottom"
                                                >
                                                    <ChevronDown size={16} strokeWidth={2.5} />
                                                </button>
                                            )}

                                            {/* Sticky bottom input */}
                                            <div className="sticky bottom-0 mt-auto pt-3 pb-4 shrink-0" style={{ backgroundColor: 'var(--color-bg)' }}>
                                                {chatNotice && (
                                                    <div className="flex justify-center mb-2">
                                                        <span
                                                            className="badge badge-warning animate-fade-in"
                                                            style={{ fontSize: '11px', padding: '0.25rem 0.75rem' }}
                                                        >
                                                            {chatNotice}
                                                        </span>
                                                    </div>
                                                )}
                                                <ChatComposer
                                                    query={chatInput}
                                                    setQuery={setChatInput}
                                                    onSend={() => chatInput.trim() && !llmLoading && handleChatSend(chatSessionId, chatInput)}
                                                    language={language}
                                                    disabled={llmLoading || hasPendingChatMessage}
                                                    loading={llmLoading}
                                                    activeCategories={activeCategories}
                                                    debugMode={debugMode}
                                                    chatContentTypes={chatContentTypes}
                                                    setChatContentTypes={setChatContentTypes}
                                                    compact
                                                    placeholder="Ask a follow-up question..."
                                                />
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
            </div>

            {/* Mobile Navigation Buttons - Only visible on mobile, hidden while a filter modal is open
                so they don't collide with the modal's Apply button (both are fixed to the same corner). */}
            {currentPage !== 'feedback' && !filterModalOpen && (
                <button
                    onClick={() => setCurrentPage('feedback')}
                    className="btn btn-primary md:hidden fixed bottom-6 right-6 p-3 rounded-full shadow-lg z-50"
                    aria-label="Feedback"
                >
                    <Mail size={20} />
                </button>
            )}

            {currentPage !== 'home' && !filterModalOpen && (
                <button
                    onClick={() => setCurrentPage('home')}
                    className="btn btn-secondary md:hidden fixed bottom-6 left-6 p-3 rounded-full shadow-lg z-50"
                    aria-label="Home"
                >
                    <Home size={20} />
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
