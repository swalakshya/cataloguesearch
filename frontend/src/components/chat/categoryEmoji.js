import React from 'react';
import mic from '../../assets/emoji/mic.png';
import scroll from '../../assets/emoji/scroll.png';
import books from '../../assets/emoji/books.png';

// WhatsApp-style emoji, self-hosted (not loaded from a CDN at runtime) so
// these core, always-visible icons don't depend on a third party being up.
// Colorful by design — unlike Lucide (single-color stroke icons), these give
// the same illustrated, multi-hue look the mocks use, consistently across
// every OS/browser instead of relying on the system emoji font.
// "Curated" (the stats-strip tile) intentionally reuses the Books icon rather
// than a 4th distinct asset — it's the same "printed literature" idea.
export const CATEGORY_EMOJI_SRC = {
    Pravachan: mic,
    Granth: scroll,
    Books: books,
    Curated: books,
};

// `size` (px) is the usual fixed-size path, used by every existing caller.
// Omit it and size via `className` instead (e.g. Tailwind `w-[70%] h-[70%]`)
// when the icon needs to track a runtime-computed box instead of a constant —
// passing both isn't meaningful, so `size` wins if present.
export function CategoryEmojiIcon({ category, size, className = '' }) {
    const src = CATEGORY_EMOJI_SRC[category];
    if (!src) return null;
    return (
        <img
            src={src}
            alt=""
            {...(size ? { width: size, height: size } : {})}
            className={className}
            style={{ display: 'inline-block', flexShrink: 0 }}
        />
    );
}
