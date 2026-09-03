// --- API SERVICE ---
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';
const LLM_API_BASE_URL = process.env.REACT_APP_LLM_API_BASE_URL || 'http://localhost:8012';

// Shared client-side cache for getCatalogue() -- see its definition below for
// why this lives at module scope instead of on the `api` object.
const CATALOGUE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let catalogueCache = { data: null, timestamp: 0 };
let catalogueInFlight = null;

export const api = {
    getAppConfig: async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/config`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not fetch app config", error);
            return { app_name: 'swalakshya', debug_mode: false, active_categories: ['Pravachan', 'Granth'] };
        }
    },

    getMetadata: async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/metadata`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            // data structure: {"Pravachan": {"Name_hi": [...], "Name_gu": [...]}, "Granth": {...}}
            // Transform to: {"Pravachan": {"hindi": {"Name": [...], ...}, "gujarati": {...}}, "Granth": {...}}

            const langKeyMap = {
                'hi': 'hindi',
                'gu': 'gujarati'
            };

            const transformedData = {};

            for (const [contentType, typeMetadata] of Object.entries(data)) {
                transformedData[contentType] = { hindi: {}, gujarati: {} };

                for (const [compositeKey, values] of Object.entries(typeMetadata)) {
                    // compositeKey is like "Name_hi", "Anuyog_gu", etc.
                    const lastUnderscoreIndex = compositeKey.lastIndexOf('_');
                    if (lastUnderscoreIndex !== -1) {
                        const fieldName = compositeKey.substring(0, lastUnderscoreIndex);
                        const langCode = compositeKey.substring(lastUnderscoreIndex + 1);
                        const langName = langKeyMap[langCode] || langCode;

                        if (!transformedData[contentType][langName]) {
                            transformedData[contentType][langName] = {};
                        }
                        transformedData[contentType][langName][fieldName] = values;
                    }
                }
            }

            return transformedData;
        } catch (error) {
            console.error("API Error: Could not fetch metadata", error);
            return {};
        }
    },

    // Content catalogue: one row per (category, language, Granth, Series) that has
    // a curated `count` in cataloguesearch-configs. Backs the /search-index page.
    // Shared client-side cache: whoever calls getCatalogue() first (StatsStrip,
    // SearchIndex.js, ...) triggers the fetch; everyone else -- even a
    // concurrent caller in the same tick -- gets the same cached array or the
    // same in-flight promise, never a duplicate request. TTL expiry makes the
    // *next* call re-fetch lazily; no background timer, since there's no
    // reason to poll while nothing using this data is even mounted.
    getCatalogue: async () => {
        const isFresh = catalogueCache.data
            && (Date.now() - catalogueCache.timestamp) < CATALOGUE_TTL_MS;
        if (isFresh) return catalogueCache.data;
        if (catalogueInFlight) return catalogueInFlight;

        catalogueInFlight = (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/catalogue`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const rows = await response.json();
                catalogueCache = { data: rows, timestamp: Date.now() };
                return rows;
            } catch (error) {
                console.error("API Error: Could not fetch content catalogue", error);
                // Serve stale data over nothing if we have it; otherwise empty.
                return catalogueCache.data || [];
            } finally {
                catalogueInFlight = null;
            }
        })();
        return catalogueInFlight;
    },

    // onProgress(category, partialResult) is called after each category arrives.
    // Returns the final merged result when the stream closes.
    search: async (requestPayload, onProgress) => {
        const _empty = () => ({ results: [], total_hits: 0, page_size: 20, page_number: 1 });
        const CAT_KEY = { Pravachan: 'pravachan_results', Granth: 'granth_results', Books: 'books_results' };
        const result = {
            pravachan_results: _empty(),
            granth_results: _empty(),
            books_results: _empty(),
            suggestions: [],
        };
        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Query-Source': 'search' },
                body: JSON.stringify(requestPayload),
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete last line
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let payload;
                    try { payload = JSON.parse(line.slice(6)); } catch (e) { console.warn('SSE: failed to parse event:', e, line); continue; }
                    if (payload.type === 'category') {
                        const key = CAT_KEY[payload.category];
                        if (key) {
                            result[key] = {
                                results: payload.results || [],
                                total_hits: payload.total_hits || 0,
                                page_size: payload.page_size || 20,
                                page_number: payload.page_number || 1,
                            };
                            if (onProgress) onProgress(payload.category, { ...result });
                        }
                    } else if (payload.type === 'done') {
                        result.suggestions = payload.suggestions || [];
                    }
                }
            }
            return result;
        } catch (error) {
            console.error("API Error: Could not perform search", error);
            if (onProgress) onProgress(null, { ...result, error: error.message });
            return result;
        }
    },
    
    // Exports up to `count` results for a single category as a downloadable PDF.
    // `searchPayload` carries the same query/filters as the active search (see
    // buildSearchPayload in App.js) so the export matches what's on screen.
    exportPdf: async ({ category, count, ...searchPayload }) => {
        const response = await fetch(`${API_BASE_URL}/export-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...searchPayload, category, count }),
        });
        if (!response.ok) {
            let detail = null;
            try { const body = await response.json(); detail = body?.detail || null; } catch { detail = null; }
            throw new Error(detail || `HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : `swalakshya-khoj-${category.toLowerCase()}.pdf`;
        return { blob, filename };
    },

    getSimilarDocuments: async (docId) => {
        try {
            const response = await fetch(`${API_BASE_URL}/similar-documents/${docId}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return { ...data, results: data.results || [] };
        } catch (error) { 
            console.error("API Error: Could not fetch similar documents", error); 
            return { total_results: 0, results: [] }; 
        }
    },
    
    getParagraphContext: async (chunkId) => {
        try {
            const response = await fetch(`${API_BASE_URL}/context/${chunkId}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not fetch context", error);
            return null;
        }
    },

    getChunk: async (chunkId, language = 'hi') => {
        try {
            const response = await fetch(`${API_BASE_URL}/chunk/${encodeURIComponent(chunkId)}?language=${language}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not fetch chunk", error);
            return null;
        }
    },

    getGranthVerse: async (originalFilename, verseSeqNum) => {
        try {
            const encodedFilename = encodeURIComponent(originalFilename);
            const response = await fetch(`${API_BASE_URL}/granth/verse?original_filename=${encodedFilename}&verse_seq_num=${verseSeqNum}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not fetch granth verse", error);
            return null;
        }
    },

    getGranthProse: async (originalFilename, proseSeqNum) => {
        try {
            const encodedFilename = encodeURIComponent(originalFilename);
            const response = await fetch(`${API_BASE_URL}/granth/prose?original_filename=${encodedFilename}&prose_seq_num=${proseSeqNum}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not fetch granth prose", error);
            return null;
        }
    },

    submitFeedback: async (feedbackData) => {
        try {
            const response = await fetch(`${API_BASE_URL}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(feedbackData),
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not submit feedback", error);
            throw error;
        }
    },

    // --- Feedback Admin API (chat service) ---
    adminFeedbackAuth: async (keyHash) => {
        const response = await fetch(`${LLM_API_BASE_URL}/v1/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key_hash: keyHash }),
        });
        if (!response.ok) throw new Error('Invalid key');
        return await response.json(); // { token }
    },

    listFeedback: async (feedbackToken, { status, limit = 50, offset = 0 } = {}) => {
        const params = new URLSearchParams({ limit, offset });
        if (status) params.set('status', status);
        const response = await fetch(`${LLM_API_BASE_URL}/v1/admin/feedback?${params}`, {
            headers: { 'Authorization': `Bearer ${feedbackToken}` },
        });
        if (!response.ok) {
            const err = new Error('Failed to load feedback');
            err.status = response.status;
            throw err;
        }
        return await response.json();
    },

    getFeedback: async (feedbackToken, id) => {
        const response = await fetch(`${LLM_API_BASE_URL}/v1/admin/feedback/${encodeURIComponent(id)}`, {
            headers: { 'Authorization': `Bearer ${feedbackToken}` },
        });
        if (!response.ok) {
            const err = new Error('Failed to load feedback record');
            err.status = response.status;
            throw err;
        }
        return await response.json();
    },

    patchFeedback: async (feedbackToken, id, { status, moderator_comment }) => {
        const response = await fetch(`${LLM_API_BASE_URL}/v1/admin/feedback/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${feedbackToken}`,
            },
            body: JSON.stringify({ status, moderator_comment }),
        });
        if (!response.ok) {
            const err = new Error('Failed to update feedback');
            err.status = response.status;
            throw err;
        }
        return await response.json();
    },

    submitAnswerFeedback: async (feedbackData) => {
        const response = await fetch(`${LLM_API_BASE_URL}/v1/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feedbackData),
        });
        let body;
        try { body = await response.json(); } catch { body = {}; }
        if (!response.ok) {
            const error = new Error(body?.detail || `HTTP error! status: ${response.status}`);
            error.status = response.status;
            error.detail = body?.detail || null;
            throw error;
        }
        return body;
    },

    answer: async (requestPayload) => {
        try {
            const response = await fetch(`${LLM_API_BASE_URL}/v1/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not fetch answer", error);
            throw error;
        }
    },

    createChatSession: async (requestPayload) => {
        try {
            const response = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not create chat session", error);
            throw error;
        }
    },

    sendChatMessage: async (sessionId, requestPayload) => {
        try {
            // Step 1: submit (returns 202 { message_id })
            const submitResponse = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
            });
            if (!submitResponse.ok) {
                let detail = null;
                try { const b = await submitResponse.json(); detail = b?.detail || null; } catch { detail = null; }
                const error = new Error(detail || `HTTP error! status: ${submitResponse.status}`);
                error.status = submitResponse.status;
                error.detail = detail;
                throw error;
            }
            const { message_id: messageId } = await submitResponse.json();

            // Step 2: poll /result until done or error
            return await pollChatMessageResult(sessionId, messageId);
        } catch (error) {
            console.error("API Error: Could not send chat message", error);
            throw error;
        }
    },

    sendChatMessageStream: async (sessionId, requestPayload, onEvent) => {
        try {
            // Generate a stable message ID so reconnects don't duplicate the LLM call
            const clientMessageId = crypto.randomUUID();

            // Step 1: Submit (returns 202 { message_id })
            const submitRes = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...requestPayload, client_message_id: clientMessageId }),
            });
            if (!submitRes.ok) {
                let detail = null;
                try { const b = await submitRes.json(); detail = b?.detail || null; } catch { detail = null; }
                const error = new Error(detail || `HTTP error! status: ${submitRes.status}`);
                error.status = submitRes.status;
                error.detail = detail;
                throw error;
            }
            const { message_id: messageId } = await submitRes.json();

            // Step 2: Open the GET /stream SSE endpoint (decoupled from submission)
            return await streamMessageResult(sessionId, messageId, { lastEventId: null, onEvent });
        } catch (error) {
            console.error("API Error: Could not stream chat message", error);
            throw error;
        }
    },

    // SF2/SF3 decoupled methods — used by App.js for resilient chat delivery
    submitChatMessage: async (sessionId, requestPayload) => {
        const response = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
        });
        if (!response.ok) {
            let detail = null;
            try { const b = await response.json(); detail = b?.detail || null; } catch { detail = null; }
            const error = new Error(detail || `HTTP error! status: ${response.status}`);
            error.status = response.status;
            error.detail = detail;
            throw error;
        }
        return response.json(); // { message_id, status }
    },

    getChatMessageResult: async (sessionId, messageId) => {
        const response = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages/${messageId}/result`);
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) {
            const error = new Error(body?.detail || `HTTP error! status: ${response.status}`);
            error.status = response.status;
            error.detail = body?.detail || null;
            throw error;
        }
        return body; // { status: 'processing'|'done'|'error', message_id, ...result }
    },

    streamChatMessageResult: async (sessionId, messageId, { lastEventId = null, onEvent, onEventId } = {}) => {
        return streamMessageResult(sessionId, messageId, { lastEventId, onEvent, onEventId });
    },

    closeChatSession: async (sessionId) => {
        try {
            const response = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}`, {
                method: 'DELETE',
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not close chat session", error);
            throw error;
        }
    },

    checkLlmHealth: async () => {
        try {
            const response = await fetch(`${LLM_API_BASE_URL}/v1/health`);
            return response.ok;
        } catch {
            return false;
        }
    },

    // --- Admin API ---
    adminAuth: async (keyHash) => {
        const response = await fetch(`${API_BASE_URL}/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key_hash: keyHash }),
        });
        if (!response.ok) throw new Error('Invalid key');
        return await response.json(); // { token }
    },

    getAdminConfig: async (token) => {
        const response = await fetch(`${API_BASE_URL}/admin/config`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Unauthorized');
        return await response.json(); // { defaults, overrides, effective }
    },

    updateAdminConfig: async (token, updates) => {
        const response = await fetch(`${API_BASE_URL}/admin/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(updates),
        });
        if (!response.ok) throw new Error('Failed to update config');
        return await response.json();
    },

    resetAdminConfig: async (token, key = null) => {
        const url = key
            ? `${API_BASE_URL}/admin/config/${key}`
            : `${API_BASE_URL}/admin/config`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to reset config');
        return await response.json();
    },

    getAgentConfig: async (token) => {
        const response = await fetch(`${API_BASE_URL}/admin/agent-config`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Unauthorized');
        return await response.json();
    },

    updateAgentConfig: async (token, updates) => {
        const response = await fetch(`${API_BASE_URL}/admin/agent-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(updates),
        });
        if (!response.ok) throw new Error('Failed to update agent config');
        return await response.json();
    },

    resetAgentConfig: async (token, key = null) => {
        const url = key
            ? `${API_BASE_URL}/admin/agent-config/${key}`
            : `${API_BASE_URL}/admin/agent-config`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to reset agent config');
        return await response.json();
    },

    getAnalytics: async (token, { fromDate, toDate, source, language, minHits, maxHits } = {}) => {
        const params = new URLSearchParams();
        if (fromDate) params.set('from_date', fromDate);
        if (toDate) params.set('to_date', toDate);
        const sourceList = Array.isArray(source) ? source : (source ? [source] : []);
        if (sourceList.length > 0) params.set('source', sourceList.join(','));
        if (language) params.set('language', language);
        if (minHits != null && minHits !== 0) params.set('min_hits', minHits);
        if (maxHits != null && maxHits !== 1000) params.set('max_hits', maxHits);
        const response = await fetch(`${API_BASE_URL}/admin/analytics?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) {
            let detail = null;
            try {
                const body = await response.json();
                detail = body?.detail || null;
            } catch {
                detail = null;
            }
            if (response.status === 401) throw new Error('Unauthorized');
            throw new Error(detail || 'Failed to load analytics');
        }
        return await response.json();
    },

    getChatRequestLogs: async (
        token,
        { fromTs, toTs, requestId, sessionId, userId, status = 'all', limit = 20, offset = 0 } = {}
    ) => {
        const params = new URLSearchParams();
        if (fromTs != null) params.set('from_ts', String(fromTs));
        if (toTs != null) params.set('to_ts', String(toTs));
        if (requestId) params.set('request_id', requestId);
        if (sessionId) params.set('session_id', sessionId);
        if (userId) params.set('user_id', userId);
        if (status && status !== 'all') params.set('status', status);
        params.set('limit', String(limit));
        params.set('offset', String(offset));

        const response = await fetch(`${API_BASE_URL}/admin/chat-request-logs?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) {
            let detail = null;
            try {
                const body = await response.json();
                detail = body?.detail || null;
            } catch {
                detail = null;
            }
            if (response.status === 401) throw new Error('Unauthorized');
            throw new Error(detail || 'Failed to load chat request logs');
        }
        return await response.json();
    },

    getChatRequestLogDetail: async (token, requestId) => {
        const response = await fetch(`${API_BASE_URL}/admin/chat-request-logs/${encodeURIComponent(requestId)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) {
            let detail = null;
            try {
                const body = await response.json();
                detail = body?.detail || null;
            } catch {
                detail = null;
            }
            if (response.status === 401) throw new Error('Unauthorized');
            throw new Error(detail || 'Failed to load chat request log detail');
        }
        return await response.json();
    },

    getCostAnalysis: async (
        token,
        { fromTs, toTs, requestId, sessionId, userId, steps, limit = 50, offset = 0 } = {}
    ) => {
        const params = new URLSearchParams();
        if (fromTs != null) params.set('from', String(fromTs));
        if (toTs != null) params.set('to', String(toTs));
        if (requestId) params.set('request_id', requestId);
        if (sessionId) params.set('session_id', sessionId);
        if (userId) params.set('user_id', userId);
        if (Array.isArray(steps)) steps.forEach((s) => params.append('step', s));
        params.set('limit', String(limit));
        params.set('offset', String(offset));

        const response = await fetch(`${LLM_API_BASE_URL}/v1/admin/cost-analysis?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) {
            let detail = null;
            try {
                const body = await response.json();
                detail = body?.detail || null;
            } catch {
                detail = null;
            }
            if (response.status === 401) throw new Error('Unauthorized');
            throw new Error(detail || 'Failed to load cost analysis');
        }
        return await response.json();
    },
};

// Streams GET /stream SSE for a submitted message job. Used by sendChatMessageStream.
// lastEventId: resume from this event index (for reconnect); null = start from beginning.
// onEventId: called with each received SSE id for the caller to persist the cursor.
async function streamMessageResult(sessionId, messageId, { lastEventId = null, onEvent, onEventId } = {}) {
    const cursorParam = lastEventId !== null ? `?last_event_id=${lastEventId}` : '';
    const streamUrl = `${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages/${messageId}/stream${cursorParam}`;

    const response = await fetch(streamUrl);
    if (!response.ok) {
        let detail = null;
        try { const b = await response.json(); detail = b?.detail || null; } catch { detail = null; }
        const error = new Error(detail || `HTTP error! status: ${response.status}`);
        error.status = response.status;
        error.detail = detail;
        throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalPayload = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            if (line.startsWith('id: ')) {
                onEventId?.(Number(line.slice(4)));
                continue;
            }
            if (!line.startsWith('data: ')) continue;
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'stage') {
                onEvent?.(payload);
            } else if (payload.type === 'final') {
                finalPayload = payload.data;
            } else if (payload.type === 'error') {
                const error = new Error(payload.detail || 'message_failed');
                error.status = payload.status;
                error.detail = payload.detail;
                throw error;
            }
        }
    }

    return finalPayload;
}

// Polls GET /result until the job is done or errored. Used by sendChatMessage.
async function pollChatMessageResult(sessionId, messageId, { maxWaitMs = 300_000 } = {}) {
    const resultUrl = `${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages/${messageId}/result`;
    const deadline = Date.now() + maxWaitMs;
    let delay = 500;

    while (Date.now() < deadline) {
        const res = await fetch(resultUrl);
        if (res.status === 202) {
            const waitMs = delay;
            delay = Math.min(Math.floor(delay * 1.5), 3000);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
        }
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        if (!res.ok) {
            const error = new Error(body?.detail || `HTTP error! status: ${res.status}`);
            error.status = res.status;
            error.detail = body?.detail || null;
            throw error;
        }
        if (body?.status === 'error') {
            const error = new Error(body.detail || 'message_failed');
            error.status = 500;
            error.detail = body.detail;
            throw error;
        }
        // status === 'done': strip the envelope fields and return just the payload
        const { status: _s, message_id: _m, ...result } = body;
        return result;
    }

    const error = new Error('message_timeout');
    error.detail = 'message_timeout';
    throw error;
}
