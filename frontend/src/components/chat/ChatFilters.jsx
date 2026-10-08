import React from 'react';
import CategoryChips from '../CategoryChips';

// Which categories to offer here is chat-specific (debug mode reveals Books
// even when it's not admin-enabled) — the actual chip rendering/toggling is
// shared with Settings' "Default filter type" pickers via CategoryChips.
const ChatFilters = ({ activeCategories, debugMode, chatContentTypes, setChatContentTypes, compact = false }) => {
    const visibleCategories = [
        ...activeCategories,
        ...(debugMode && !activeCategories.includes('Books') ? ['Books'] : [])
    ];

    // Compact now lives folded into the composer card's footer (see
    // InputActionBar's `footer` slot), left-aligned like the rest of that
    // card's content; non-compact is still its own standalone floating row
    // in the empty-state hero, where centering reads better.
    return (
        <div className={`flex items-center flex-wrap ${compact ? 'gap-1.5' : 'gap-2.5 justify-center'}`}>
            <span className={`font-semibold text-ink-muted uppercase tracking-wide ${compact ? 'text-[10px]' : 'text-xs'}`}>
                Filter:
            </span>
            <CategoryChips
                categories={visibleCategories}
                selected={chatContentTypes}
                onChange={setChatContentTypes}
                compact={compact}
            />
        </div>
    );
};

export default ChatFilters;
