import React from 'react';
import { CategoryEmojiIcon } from './categoryEmoji';

// Each category gets its own token-driven border/wash color (the same mapping
// used for the reference-card badges in chat answers) plus a colorful Twemoji
// icon — matching the mock, where Pravachan/Granth/Books read as distinct,
// illustrated categories, not three monochrome toggles of the same button.
const CATEGORY_META = {
    Pravachan: { colorVar: '--color-info' },
    Granth: { colorVar: '--color-brand' },
    Books: { colorVar: '--color-success' },
};

const ChatFilters = ({ activeCategories, debugMode, chatContentTypes, setChatContentTypes, compact = false }) => {
    const visibleCategories = [
        ...activeCategories,
        ...(debugMode && !activeCategories.includes('Books') ? ['Books'] : [])
    ];

    const toggleCategory = (cat) => {
        setChatContentTypes(prev => {
            if (prev.includes(cat)) {
                if (prev.length === 1) return prev;
                return prev.filter(c => c !== cat);
            }
            return [...prev, cat];
        });
    };

    const tileStyle = (active, colorVar = '--color-ink-muted') => active
        ? { backgroundColor: `color-mix(in srgb, var(${colorVar}) 10%, var(--color-surface))`, color: `var(${colorVar})`, borderColor: `var(${colorVar})` }
        : { backgroundColor: 'var(--color-surface)', color: 'var(--color-ink-muted)', borderColor: 'var(--color-border)' };

    const tileClass = compact
        ? 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium border'
        : 'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border-2 font-semibold text-sm';
    const iconSize = compact ? 12 : 15;

    return (
        <div className={`flex items-center flex-wrap ${compact ? 'gap-1.5' : 'gap-2.5 justify-center'}`}>
            {visibleCategories.map(cat => {
                const active = chatContentTypes.includes(cat);
                const meta = CATEGORY_META[cat] || {};
                return (
                    <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={`${tileClass} transition-colors`}
                        style={tileStyle(active, meta.colorVar)}
                    >
                        <CategoryEmojiIcon category={cat} size={iconSize} />
                        <span>{cat}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default ChatFilters;
