const CHAT_ACCURACY_KEY = 'default_accuracy_chat';

export function getStoredChatAccuracyMode() {
    try { return localStorage.getItem(CHAT_ACCURACY_KEY) === 'true'; } catch { return false; }
}

export function setStoredChatAccuracyMode(enabled) {
    try { localStorage.setItem(CHAT_ACCURACY_KEY, String(enabled === true)); } catch {}
}
