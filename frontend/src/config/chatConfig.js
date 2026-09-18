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

// AuthContext dispatches this on logout so a currently-mounted ChatPage can
// clear its own in-memory session immediately, not just on next page load.
// This is purely a local/browser-side reset -- it must never touch the
// server (the conversation stays in the account's History, same as ending a
// chat normally does).
export const AUTH_LOGOUT_EVENT = 'swalakshya:logout';

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

// Exported as the app's hardcoded default, with no localStorage involved —
// used to seed a logged-in user who has no saved server settings yet.
export function envDefault() {
    const raw = String(process.env.REACT_APP_CHAT_RESPONSE_FORMAT || '').trim().toLowerCase();
    return raw === 'summary' ? 'summary' : 'structured';
}

// Exported so the server-settings path in App.js's sync effect can apply
// the same validity check this file's own localStorage read/write already
// enforce, before trusting a settings.answerFormat value from the backend.
export function isValidAnswerFormat(format) {
    return format === 'summary' || format === 'structured';
}

export function getStoredAnswerFormat() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isValidAnswerFormat(stored)) return stored;
    } catch {}
    return envDefault();
}

export function setStoredAnswerFormat(format) {
    if (!isValidAnswerFormat(format)) return;
    try { localStorage.setItem(STORAGE_KEY, format); } catch {}
}
