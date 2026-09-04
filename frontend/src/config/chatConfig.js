import { ScrollText, Eye } from 'lucide-react';

// The chat answer experience is now a real per-user Settings choice
// (localStorage-backed, no login exists to store it server-side). The env
// var below is only the first-time default a fresh browser sees before
// anyone has ever chosen for themselves — once saved once, the stored value
// always wins. Any value other than "summary" falls back to "structured", so
// an unset or misspelled env value never silently breaks the chat page.
const STORAGE_KEY = 'chat_response_format';

// Also used by ChatPage to persist/restore/clear the active conversation —
// centralized here so App.js's Settings-save handler and ChatPage always
// agree on the same key instead of two hand-typed string literals drifting apart.
export const CHAT_SESSION_STORAGE_KEY = 'llmChatSession';

export const ANSWER_FORMAT_OPTIONS = [
    {
        value: 'structured',
        label: 'Verbatim',
        description: "Every answer is immediately followed by the exact scripture passage it's drawn from, quoted in full right where it's used. Choose this if you want to read the original text alongside the explanation, not just a summary of it.",
        icon: ScrollText,
    },
    {
        value: 'summary',
        label: 'At a Glance',
        description: 'A clear, consolidated answer you can read quickly, with numbered references instead of quotes in every line. Still stays true to the scriptures — no AI fluff — just offers a smoother reading experience. Click on the citation alongside the answer to view the original source.',
        icon: Eye,
    },
];

function envDefault() {
    const raw = String(process.env.REACT_APP_CHAT_RESPONSE_FORMAT || '').trim().toLowerCase();
    return raw === 'summary' ? 'summary' : 'structured';
}

export function getStoredAnswerFormat() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'summary' || stored === 'structured') return stored;
    } catch {}
    return envDefault();
}

export function setStoredAnswerFormat(format) {
    if (format !== 'summary' && format !== 'structured') return;
    try { localStorage.setItem(STORAGE_KEY, format); } catch {}
}
