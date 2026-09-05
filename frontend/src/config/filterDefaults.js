const CHAT_KEY = 'default_categories_chat';
const KHOJ_KEY = 'default_categories_khoj';

// Per-user default content-type filter for each product (Settings-configurable,
// separately from `active_categories` — the admin-config list of which
// categories exist for this deployment at all). A saved default is clamped to
// whatever's currently admin-enabled (a category disabled after being saved
// just falls out silently), and an unset/fully-invalid one falls back to
// "everything admin-enabled", never an empty selection.
function readDefaultCategories(storageKey, activeCategories) {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem(storageKey));
    } catch {}
    const candidate = Array.isArray(stored) ? stored.filter((c) => activeCategories.includes(c)) : [];
    return candidate.length > 0 ? candidate : [...activeCategories];
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
