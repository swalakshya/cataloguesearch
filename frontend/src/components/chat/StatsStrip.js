import React from 'react';
import { Link } from 'react-router-dom';
import useCatalogue from '../../hooks/useCatalogue';
import { CategoryEmojiIcon } from './categoryEmoji';

// category keys match categoryEmoji.js's CATEGORY_EMOJI_SRC, and colorVar
// matches the same category->color mapping used in ChatFilters and the
// reference-card badges, so "Pravachan" means the same color everywhere.
// `anchor` is the matching <section id> on SearchIndex.js -- each tile is a
// real link there, so the strip doubles as a mini table-of-contents from
// anywhere in the app.
const DEFAULT_LABELS = { Pravachan: 'Pravachans', Granth: 'Granths', Curated: 'Contemporary Jain Books' };

const TILES = (pravachanTotal, granthCount, booksCount, labels) => [
    { category: 'Pravachan', colorVar: '--color-info', value: pravachanTotal != null ? pravachanTotal.toLocaleString() : undefined, label: labels.Pravachan, anchor: 'pravachan-index' },
    { category: 'Granth', colorVar: '--color-brand', value: granthCount != null ? granthCount.toLocaleString() : undefined, label: labels.Granth, anchor: 'granth-index' },
    { category: 'Curated', colorVar: '--color-danger', value: booksCount != null ? booksCount.toLocaleString() : undefined, label: labels.Curated, anchor: 'contemporary-index' },
];

// Icon box is w-11/h-11 (44px) when spacious, w-7/h-7 (28px) otherwise (must
// match the Tailwind classes below in px) — the emoji image inside is sized
// as a fraction of that box rather than a separately hand-picked number, so
// the two can't drift out of ratio if a box size ever changes.
const ICON_FILL_RATIO = 0.9999;

// `labels` optionally overrides one or more of the default per-category tile
// labels (e.g. Home.js uses fuller phrasing) — every other call site renders
// with DEFAULT_LABELS, unaffected.
export default function StatsStrip({ topAccent, spacious = false, labels }) {
    const resolvedLabels = { ...DEFAULT_LABELS, ...labels };
    const iconBoxPx = spacious ? 44 : 28;
    const iconSize = Math.round(iconBoxPx * ICON_FILL_RATIO);
    // useCatalogue() shares its underlying fetch/cache with every other
    // caller (e.g. SearchIndex.js) -- see hooks/useCatalogue.js.
    const { rows, loading } = useCatalogue();
    const pravachanTotal = loading ? null : rows.reduce(
        (sum, r) => sum + (r.category === 'Pravachan' && r.count !== 'compiled' ? (parseInt(r.count, 10) || 0) : 0), 0
    );
    const granthCount = loading ? null : rows.filter((r) => r.category === 'Granth').length;
    const booksCount = loading ? null : rows.filter((r) => r.category === 'Books').length;

    const tiles = TILES(pravachanTotal, granthCount, booksCount, resolvedLabels);

    return (
        <div className={`card flex flex-col sm:flex-row items-stretch relative overflow-hidden ${spacious ? 'px-3 py-4' : 'px-2 py-2.5'}`}>
            {topAccent && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: topAccent }} />}
            {tiles.map(({ category, value, label, anchor }, i) => (
                <Link
                    key={label}
                    to={`/search-index#${anchor}`}
                    className={`flex-1 flex items-center justify-start sm:justify-center rounded-md hover:bg-bg transition-colors ${spacious ? 'gap-4 px-4 py-3' : 'gap-2.5 px-3 py-1'} ${i > 0 ? 'border-t sm:border-t-0 sm:border-l' : ''}`}
                    style={{ borderColor: 'var(--color-border)' }}
                >
                    <div
                        className={`flex items-center justify-center shrink-0 ${spacious ? 'w-11 h-11' : 'w-7 h-7'}`}
                    >
                        <CategoryEmojiIcon category={category} size={iconSize} />
                    </div>
                    <div className="leading-tight">
                        {value && <div className={spacious ? 'text-xl font-bold text-ink' : 'text-sm font-bold text-ink'}>{value}</div>}
                        <div className={value ? `${spacious ? 'text-sm' : 'text-xs'} text-ink-muted` : `${spacious ? 'text-sm' : 'text-xs'} font-bold text-ink`}>{label}</div>
                    </div>
                </Link>
            ))}
        </div>
    );
}
