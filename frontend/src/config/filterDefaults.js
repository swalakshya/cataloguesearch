const CHAT_KEY = 'default_categories_chat';
const KHOJ_KEY = 'default_categories_khoj';

// Per-user default content-type filter for each product (Settings-configurable,
// separately from `active_categories` — the admin-config list of which
// categories exist for this deployment at all). A saved default is clamped to
// whatever's currently admin-enabled (a category disabled after being saved
// just falls out silently), and an unset/fully-invalid one falls back to
// "everything admin-enabled", never an empty selection.
//
// Exported (not just used internally by readDefaultCategories below) so the
// server-settings path in App.js's sync effect can apply the exact same
// clamp/fallback rules to a settings.*DefaultCategories value from the
// backend as this file already applies to a localStorage one -- the backend
// itself also clamps against its own admin-active-categories list, but a
// stale client or manual API write should still be defended against the
// same way an offline value already is.
export function clampCategories(candidate, activeCategories) {
    const filtered = Array.isArray(candidate) ? candidate.filter((c) => activeCategories.includes(c)) : [];
    return filtered.length > 0 ? filtered : [...activeCategories];
}

function readDefaultCategories(storageKey, activeCategories) {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem(storageKey));
    } catch {}
    return clampCategories(stored, activeCategories);
}

function writeDefaultCategories(storageKey, categories) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(categories));
    } catch {}
}

export const getStoredChatDefaultCategories = (activeCategories) => readDefaultCategories(CHAT_KEY, activeCategories);
export const setStoredChatDefaultCategories = (categories) => writeDefaultCategories(CHAT_KEY, categories);

export const getStoredKhojDefaultCategories = (activeCategories) => readDefaultCategories(KHOJ_KEY, activeCategories);
export const setStoredKhojDefaultCategories = (categories) => writeDefaultCategories(KHOJ_KEY, categories);
