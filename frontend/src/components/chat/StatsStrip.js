import React from 'react';
import { getAllStats } from '../../utils/searchableContent';
import { CategoryEmojiIcon } from './categoryEmoji';

// category keys match categoryEmoji.js's CATEGORY_EMOJI_SRC, and colorVar
// matches the same category->color mapping used in ChatFilters and the
// reference-card badges, so "Pravachan" means the same color everywhere.
const TILES = (stats) => [
    { category: 'Pravachan', colorVar: '--color-info', value: stats.pravachan.grandTotal.toLocaleString(), label: 'Pravachans' },
    { category: 'Granth', colorVar: '--color-brand', value: stats.granth.searchable.toLocaleString(), label: 'Granths' },
    { category: 'Curated', colorVar: '--color-danger', label: 'Curated Jain Literature' },
];

export default function StatsStrip() {
    const stats = getAllStats();
    const tiles = TILES(stats);

    return (
        <div className="card flex items-stretch px-2 py-2.5">
            {tiles.map(({ category, colorVar, value, label }, i) => (
                <div key={label} className={`flex-1 flex items-center justify-center gap-2.5 px-3 ${i > 0 ? 'border-l' : ''}`} style={{ borderColor: 'var(--color-border)' }}>
                    <div
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, var(${colorVar}) 14%, var(--color-surface))` }}
                    >
                        <CategoryEmojiIcon category={category} size={16} />
                    </div>
                    <div className="leading-tight">
                        {value && <div className="text-sm font-bold text-ink">{value}</div>}
                        <div className={value ? 'text-xs text-ink-muted' : 'text-xs font-bold text-ink'}>{label}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
