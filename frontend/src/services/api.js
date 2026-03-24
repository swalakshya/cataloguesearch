// --- API SERVICE ---
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';
const LLM_API_BASE_URL = process.env.REACT_APP_LLM_API_BASE_URL || 'http://localhost:8012';

export const api = {
    getMetadata: async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/metadata`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            // data structure: {"Pravachan": {"Granth_hi": [...], "Granth_gu": [...]}, "Granth": {...}}
            // Transform to: {"Pravachan": {"hindi": {"Granth": [...], ...}, "gujarati": {...}}, "Granth": {...}}

            const langKeyMap = {
                'hi': 'hindi',
                'gu': 'gujarati'
            };

            const transformedData = {};

            for (const [contentType, typeMetadata] of Object.entries(data)) {
                transformedData[contentType] = { hindi: {}, gujarati: {} };

                for (const [compositeKey, values] of Object.entries(typeMetadata)) {
                    // compositeKey is like "Granth_hi", "Year_gu", etc.
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
    
    search: async (requestPayload) => {
        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            // Return new SearchResponse format with pravachan_results and granth_results
            return {
                pravachan_results: data.pravachan_results || { results: [], total_hits: 0, page_size: 20, page_number: 1 },
                granth_results: data.granth_results || { results: [], total_hits: 0, page_size: 20, page_number: 1 },
                suggestions: data.suggestions || []
            };
        } catch (error) {
            console.error("API Error: Could not perform search", error);
            return {
                pravachan_results: { results: [], total_hits: 0, page_size: 20, page_number: 1 },
                granth_results: { results: [], total_hits: 0, page_size: 20, page_number: 1 },
                suggestions: []
            };
        }
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
            const response = await fetch(`${LLM_API_BASE_URL}/v1/chat/sessions/${sessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("API Error: Could not send chat message", error);
            throw error;
        }
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
    }
};
