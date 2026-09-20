import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import { PageHeader } from '../ui';
import ChatComposer from './ChatComposer';
import StatsStrip from './StatsStrip';
import AiDisclaimer from './AiDisclaimer';
import AnswerBody from './AnswerBody';
import PdfCitationModal from './PdfCitationModal';
import ReferencePanel from './ReferencePanel';
import { ShareAnswerButtons } from './ShareAnswerButtons';
import { FeedbackButtons } from '../AibotFeedback';
import { cleanAnswerText, preTokenizeCitations } from './answerFormatting';
import { AUTH_LOGOUT_EVENT, CHAT_SESSION_STORAGE_KEY } from '../../config/chatConfig';
import { getStoredChatDefaultCategories } from '../../config/filterDefaults';
import { USER_ID } from '../../utils/userId';
import { randomUUID } from '../../utils/uuid';
import bulbEmoji from '../../assets/emoji/bulb.svg';

const llmProvider = (process.env.REACT_APP_LLM_PROVIDER || '').trim();

// The multi-turn chat experience — session lifecycle, SSE streaming, message
// list, composer, follow-ups, share/feedback actions. Mounted by App.js only
// while currentPage === 'chat' && llmAvailable; unmount/remount (on
// navigating away and back) is what "resets" chat state between visits,
// replacing the old chatEnabled-gated effects this was extracted from.
//
// startNewChat/endChat are exposed via ref because the "New Chat" trigger
// lives in the Sidebar, a sibling in App.js's tree, not a descendant here —
// but the Sidebar only ever renders that button while currentPage === 'chat'
// (see Sidebar.js), i.e. exactly when this component is mounted.
const ChatPage = forwardRef(function ChatPage(
    {
        language,
        appName,
        activeCategories,
        debugMode,
        activeFilters,
        startYear,
        endYear,
        query,
        setQuery,
        pendingChatQuestion,
        onPendingChatQuestionConsumed,
        onNavigateFeedback,
        answerFormat,
        chatDefaultCategories,
        remoteSessionId,
        remoteSessionNavKey,
        onSessionActivity,
    },
    ref
) {
    const [llmError, setLlmError] = useState(null);
    const [chatNotice, setChatNotice] = useState(null);
    // Drives the one shared PdfCitationModal instance — set by either
    // StructuredAnswer's "View PDF" click or SummaryAnswer's badges/panel.
    const [activeCitation, setActiveCitation] = useState(null);
    const [llmLoading, setLlmLoading] = useState(false);
    const [chatSessionId, setChatSessionId] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatContentTypes, setChatContentTypes] = useState(() => chatDefaultCategories || activeCategories || ['Pravachan', 'Granth']);
    const [expandedAnswers, setExpandedAnswers] = useState({});
    const [displayedTexts, setDisplayedTexts] = useState({});
    const [chunkTextsCache, setChunkTextsCache] = useState({});
    const [showScrollDown, setShowScrollDown] = useState(false);

    const typingIntervalsRef = useRef({});
    const recoveryTimeoutRef = useRef(null);
    const messagesEndRef = useRef(null);
    const latestUserBubbleRef = useRef(null);
    const activeChatRunRef = useRef(0);
    // Tracks the localId of the turn currently being streamed live in handleChatSend.
    // recoverPendingMessage checks this before opening a competing stream for the same turn.
    const activeStreamLocalIdRef = useRef(null);

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
            localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
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

    // Restore a session on mount, and again whenever remoteSessionId changes.
    // The second part matters because History lives inside this very page's
    // own sidebar (see Sidebar.js) — clicking an item is almost always a
    // same-path navigate('/chat', { state: { remoteSessionId } }) while
    // ChatPage is already mounted, which React Router does not remount for,
    // so a mount-only effect would only ever catch the very first click.
    // Depending on remoteSessionId here is what makes a second or third
    // click (while still on /chat) actually load the newly-picked session.
    // remoteSessionNavKey (a fresh timestamp set on every History click, see
    // Sidebar.js) is also a dependency so that re-clicking the SAME item
    // twice in a row still re-triggers this -- remoteSessionId alone
    // wouldn't change, e.g. after "New Chat" cleared the view and the user
    // picks that same conversation again.
    useEffect(() => {
        const applyMessages = (messages) => {
            setChatMessages(messages);
            setDisplayedTexts(
                messages.reduce((acc, msg, idx) => {
                    if (msg?.role === 'assistant' && msg?.content) {
                        acc[msg.localId ?? idx] = cleanAnswerText(msg.content);
                    }
                    return acc;
                }, {})
            );
        };

        if (remoteSessionId) {
            let cancelled = false;
            api.getChatSession(remoteSessionId)
                .then((data) => {
                    if (cancelled) return;
                    setChatSessionId(data.session_id);
                    applyMessages(data.messages || []);
                })
                .catch((error) => console.warn('Could not load session from history:', error));
            return () => { cancelled = true; };
        }

        try {
            const stored = localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed?.sessionId) {
                    setChatSessionId(parsed.sessionId);
                    applyMessages(parsed.messages || []);
                }
            }
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, [remoteSessionId, remoteSessionNavKey]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        try {
            if (chatSessionId) {
                localStorage.setItem(
                    CHAT_SESSION_STORAGE_KEY,
                    JSON.stringify({ sessionId: chatSessionId, messages: chatMessages })
                );
            } else {
                localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
            }
        } catch (error) {
            console.warn('localStorage not available:', error);
        }
    }, [chatSessionId, chatMessages]);

    // Sidebar's History list has no other way to know a session was created
    // or just got its first exchange (and therefore its title) — this tells
    // it to refetch. Deliberately depends on chatMessages.length, not the
    // full chatMessages array: a streaming answer's stageLabel updates
    // in place (same length, same array reference replaced but same size)
    // many times per turn, and none of those intermediate updates are
    // something History needs to know about — only an add/remove (a new
    // session, or the pending message resolving) actually changes the count.
    useEffect(() => {
        onSessionActivity?.();
    }, [chatSessionId, chatMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // SF3: visibilitychange handler — recover an in-flight message when the tab returns
    useEffect(() => {
        if (!chatSessionId) return;

        const onVisible = async () => {
            if (document.visibilityState !== 'visible') return;
            void recoverPendingMessage(chatSessionId);
        };

        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [chatSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    // SF3: on startup, check if a message was in-flight when the app was last closed
    useEffect(() => {
        if (!chatSessionId) return;
        void recoverPendingMessage(chatSessionId);
    }, [chatSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    const getChatSessionPayload = useCallback(() => {
        const languageCode = language === 'gujarati' ? 'gu' : 'hi';
        return {
            language: languageCode,
            user_id: USER_ID,
            app: appName,
            ...(llmProvider ? { provider: llmProvider } : {})
        };
    }, [language, appName]);

    function buildLlmFilters() {
        const filters = {};
        const types = [...chatContentTypes];
        if (types.length) filters.content_type = types;

        if (startYear) filters.year_from = Number(startYear);
        if (endYear) filters.year_to = Number(endYear);

        (activeFilters || []).forEach((filter) => {
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

    // Renders a completed LLM response into chatMessages (replaces the pending placeholder).
    // question is stored on the msg for follow-up navigation; uses preTokenizeCitations.
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
        const localId = randomUUID();
        activeStreamLocalIdRef.current = localId; // claim ownership of this turn
        setChatMessages(prev => [
            ...prev,
            { role: 'user', content: message, localId },
            { role: 'assistant', pending: true, stage: 'understanding', stageLabel: 'Understanding your question', localId }
        ]);
        setChatInput('');

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
                response_format: answerFormat,
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
        const clientMsgId = randomUUID();

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

    // One-shot auto-start when arriving here via the Home page's "ask AI" card
    // (App.js sets pendingChatQuestion + navigates; this consumes it once).
    useEffect(() => {
        if (pendingChatQuestion && pendingChatQuestion.trim()) {
            handleChatStart(pendingChatQuestion);
            onPendingChatQuestionConsumed?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleEndChat = useCallback(async () => {
        invalidateChatRuns();
        // Used to call api.closeChatSession (DELETE) here, which permanently
        // removed the session from the server -- fine before History existed,
        // but it meant "New Chat" was quietly deleting the exact conversation
        // History is supposed to keep. This just stops treating it as the
        // active session locally; it stays in storage and in History.
        clearPendingMessage(chatSessionId);
        setChatSessionId(null);
        setChatMessages([]);
        setChatInput('');
        setLlmError(null);
        setChatNotice(null);
        setLlmLoading(false);
        clearRecoveryTimer();
        resetTypingState();
        clearPersistedChatSession();
        // Ending a chat (New Chat, or an Answer Format change forcing a reset)
        // starts a new session — re-pull the Settings default fresh (this prop
        // is always current, updated on save) rather than keeping whatever
        // filter was active in the just-ended conversation.
        setChatContentTypes(chatDefaultCategories || activeCategories || ['Pravachan', 'Granth']);
    }, [activeCategories, chatDefaultCategories, chatSessionId, clearPendingMessage, clearPersistedChatSession, clearRecoveryTimer, invalidateChatRuns, resetTypingState]);

    // AuthContext dispatches this right after logout — reuses the same
    // local-only reset as "New Chat" (no server delete), so a currently-open
    // conversation doesn't linger on screen for whoever uses this browser next.
    useEffect(() => {
        const onLogout = () => {
            handleEndChat();
            // AuthContext dispatches this synchronously, before React has
            // re-rendered and let App.js's settings-sync effect re-derive
            // chatDefaultCategories from localStorage -- handleEndChat's own
            // reset above can therefore still apply the just-logged-out
            // account's server value for one tick. We know for certain at
            // this exact point that we're offline, so read the true offline
            // default directly rather than trust that prop's timing.
            setChatContentTypes(getStoredChatDefaultCategories(activeCategories || ['Pravachan', 'Granth']));
        };
        window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
        return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
    }, [handleEndChat, activeCategories]);

    const handleNewChat = useCallback(async () => {
        await handleEndChat();
        setQuery?.('');
    }, [handleEndChat, setQuery]);

    useImperativeHandle(ref, () => ({
        startNewChat: handleNewChat,
        endChat: handleEndChat,
    }), [handleNewChat, handleEndChat]);

    return (
        <>
            <PdfCitationModal citation={activeCitation} onClose={() => setActiveCitation(null)} />

            {/* Empty state — centered search bar */}
            {chatMessages.length === 0 && !llmLoading && (
                <div className="flex flex-col items-center justify-center pb-14">
                    <div className="w-full max-w-4xl space-y-2">
                        <PageHeader
                            variant="hero"
                            title="Swalakshya AI"
                            subtitle="Get your questions answered through authentic Jain Scriptures and teachings of Pujya Gurudevshri Kanji Swami"
                        />
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
                        <div className="w-full pt-8">
                            <AiDisclaimer />
                        </div>
                        <div className="w-full pt-1">
                            <StatsStrip />
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
                                // A message replayed from History renders in whatever format it
                                // was actually answered in, not today's live Settings toggle —
                                // the two formats' citation encodings aren't interchangeable (see
                                // handleSaveAnswerFormat's comment on why answerFormat changes end
                                // the current session instead of just re-rendering it).
                                const msgFormat = msg.response_format || answerFormat;
                                const isLastUser = msg.role === 'user' && msg === lastUserMsg;
                                const isStreaming = msg.role === 'assistant' && (
                                    msg.pending || (
                                        displayedTexts[key] !== undefined &&
                                        displayedTexts[key] !== cleanAnswerText(msg.content)
                                    )
                                );
                                const fullyDisplayed = displayedTexts[key] === cleanAnswerText(msg.content);
                                return (
                                    <div key={msg.localId ? `${msg.role}-${msg.localId}` : `${msg.role}-${idx}`}>
                                        {msg.role === 'user' ? (
                                            <div ref={isLastUser ? latestUserBubbleRef : null} className="flex justify-end">
                                                <div className="shadow-sm rounded-lg rounded-tr-none px-4 py-2.5 max-w-[65%] text-white text-base" style={{ backgroundColor: 'var(--color-brand)' }}>
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
                                                    <div className="flex-1 min-w-0">
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
                                                                <div className="flex items-start justify-between gap-3 mb-3 max-w-[860px]">
                                                                    <div>
                                                                        <div className="text-sm font-bold uppercase tracking-[0.12em] text-ink">Answer</div>
                                                                    </div>
                                                                </div>
                                                                <AnswerBody
                                                                    format={msgFormat}
                                                                    msg={msg}
                                                                    displayedText={displayedTexts[key]}
                                                                    chunkTextsCache={chunkTextsCache}
                                                                    expanded={expandedAnswers[key] !== false}
                                                                    onToggleExpand={() => setExpandedAnswers(prev => ({ ...prev, [key]: prev[key] === false }))}
                                                                    onNavigateFeedback={onNavigateFeedback}
                                                                    onOpenReference={setActiveCitation}
                                                                />
                                                                {fullyDisplayed && msg.content && (
                                                                    <div className="mt-3 w-full max-w-[860px] flex items-center flex-wrap gap-2">
                                                                        <ShareAnswerButtons question={chatMessages[idx - 1]?.content} answer={cleanAnswerText(msg.content)} citationBlocks={msg.citationBlocks} />
                                                                        {msg.question && (
                                                                            <FeedbackButtons
                                                                                requestId={msg.tool_trace_id}
                                                                                question={msg.question || ''}
                                                                                answer={msg.rawAnswer || cleanAnswerText(msg.content)}
                                                                                references={msg.references}
                                                                                citations={msg.citations}
                                                                                followUpQuestions={msg.follow_up_questions}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {fullyDisplayed && msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                                                                    <div className="mt-6 w-full max-w-[860px]">
                                                                        <p className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide mb-2.5 text-ink">
                                                                            <img src={bulbEmoji} alt="" className="w-4 h-4" />
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
                                                                {fullyDisplayed && msgFormat === 'summary' && (
                                                                    <ReferencePanel citations={msg.citations} onOpenReference={setActiveCitation} />
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
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
    );
});

export default ChatPage;
