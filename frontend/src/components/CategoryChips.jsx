import React from 'react';
import { Check } from 'lucide-react';
import { CategoryEmojiIcon } from './chat/categoryEmoji';

const CATEGORY_META = {
    Pravachan: { colorVar: '--color-info' },
    Granth: { colorVar: '--color-brand' },
    Books: { colorVar: '--color-success' },
};

// Shared by the chat composer's filter row (ChatFilters) and Settings' "Default
// filter type" pickers, so both stay visually and behaviorally identical —
// including the "at least one category stays selected" guard — instead of two
// hand-duplicated implementations drifting apart.
export default function CategoryChips({ categories, selected, onChange, compact = false, align = 'center' }) {
    const toggle = (cat) => {
        if (selected.includes(cat)) {
            if (selected.length === 1) return;
            onChange(selected.filter((c) => c !== cat));
        } else {
            onChange([...selected, cat]);
        }
    };

    const tileStyle = (active, colorVar = '--color-ink-muted') => active
        ? { backgroundColor: `color-mix(in srgb, var(${colorVar}) 10%, var(--color-surface))`, color: `var(${colorVar})`, borderColor: `var(${colorVar})` }
        : { backgroundColor: 'var(--color-surface)', color: 'var(--color-ink-muted)', borderColor: 'var(--color-border)' };

    // Non-compact: minimal vertical padding + a thin border so the icon (not
    // padding) drives the button's height — otherwise a small icon centered in
    // a tall, generously-padded tile reads as tiny. Compact stays as-is: it's
    // deliberately kept slim for the sticky chat footer, where a much bigger
    // icon would reintroduce the vertical-space/overlap problems that row was
    // built to avoid.
    const tileClass = compact
        ? 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium border'
        : 'inline-flex items-center justify-center gap-2 px-5 py-1 rounded-xl border font-semibold text-sm';
    const iconSize = compact ? 12 : 24;
    const checkSize = compact ? 12 : 14;

    return (
        <div className={`flex items-center flex-wrap ${align === 'left' ? 'justify-start' : 'justify-center'} ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
            {categories.map((cat) => {
                const active = selected.includes(cat);
                const meta = CATEGORY_META[cat] || {};
                return (
                    <button
                        key={cat}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(cat)}
                        className={`${tileClass} transition-colors`}
                        style={tileStyle(active, meta.colorVar)}
                    >
                        <CategoryEmojiIcon category={cat} size={iconSize} />
                        <span>{cat}</span>
                        {active && <Check size={checkSize} />}
                    </button>
                );
            })}
        </div>
    );
}
