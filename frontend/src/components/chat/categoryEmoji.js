import React from 'react';
import mic from '../../assets/emoji/mic.svg';
import scroll from '../../assets/emoji/scroll.svg';
import books from '../../assets/emoji/books.svg';

// Twemoji SVGs, self-hosted (not loaded from a CDN at runtime) so these core,
// always-visible icons don't depend on a third party being up. Colorful by
// design — unlike Lucide (single-color stroke icons), these give the same
// illustrated, multi-hue look the mocks use, consistently across every OS/
// browser instead of relying on the system emoji font.
// "Curated" (the stats-strip tile) intentionally reuses the Books icon rather
// than a 4th distinct asset — it's the same "printed literature" idea.
export const CATEGORY_EMOJI_SRC = {
    Pravachan: mic,
    Granth: scroll,
    Books: books,
    Curated: books,
};

export function CategoryEmojiIcon({ category, size = 18, className = '' }) {
    const src = CATEGORY_EMOJI_SRC[category];
    if (!src) return null;
    return (
        <img
            src={src}
            alt=""
            width={size}
            height={size}
            className={className}
            style={{ display: 'inline-block', flexShrink: 0 }}
        />
    );
}
