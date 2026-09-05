#!/usr/bin/env node
/*
 * Guardrail: every full-screen overlay (a modal, a bottom sheet, a dropdown
 * panel that dims the page behind it, ...) should get Escape-to-close,
 * outside-click-to-close, and mobile-back-button-closes for free by either
 * calling useOverlayBehavior directly, or rendering the shared <Modal>
 * component (which calls it internally).
 *
 * This script is a cheap, regex-based heuristic — not a real parser — run
 * via `npm run check:overlays`. It exists because that exact gap (a
 * hand-rolled overlay that forgot to wire up useOverlayBehavior) has already
 * shipped once in this app; this catches the next one automatically instead
 * of relying on someone noticing in review.
 *
 * A file is flagged if it contains an overlay-shaped className (the
 * `fixed inset-0` / `fixed inset-x-0 bottom-0` patterns every real overlay
 * in this codebase uses) but neither:
 *   - calls useOverlayBehavior itself, nor
 *   - imports and renders the shared <Modal> component (which does it for you)
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Files that render an overlay-shaped div without useOverlayBehavior today —
// known, pre-existing gaps (internal /eval admin tooling, not user-facing),
// not new regressions. Fix these and remove them from here rather than
// growing this list.
const KNOWN_EXCEPTIONS = new Set([
    'components/eval/FileBrowser.js',
    'components/eval/OCRPreview.js',
]);

// Building blocks that intentionally render the overlay shape without calling
// the hook themselves — every *caller* of these is still expected to call
// useOverlayBehavior itself (Overlay.js is deliberately just the backdrop +
// click-outside wiring, not lifecycle management). Permanent exclusion, not
// a gap to fix.
const DEFINITION_FILES = new Set([
    'components/ui/Overlay.js',
]);

const OVERLAY_SHAPE_RE = /fixed\s+inset-(?:0\b|x-0\s+bottom-0)/;
const USES_HOOK_RE = /useOverlayBehavior/;
const IMPORTS_MODAL_RE = /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*['"][^'"]*\/ui(?:\/Modal)?['"]/;
const RENDERS_MODAL_RE = /<Modal[\s>]/;

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, files);
        } else if (entry.isFile() && /\.jsx?$/.test(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

function check() {
    const offenders = [];
    for (const file of walk(SRC_DIR)) {
        const relPath = path.relative(SRC_DIR, file).replace(/\\/g, '/');
        if (KNOWN_EXCEPTIONS.has(relPath) || DEFINITION_FILES.has(relPath)) continue;

        const content = fs.readFileSync(file, 'utf8');
        if (!OVERLAY_SHAPE_RE.test(content)) continue;

        const usesHook = USES_HOOK_RE.test(content);
        const usesModal = IMPORTS_MODAL_RE.test(content) && RENDERS_MODAL_RE.test(content);
        if (!usesHook && !usesModal) {
            offenders.push(relPath);
        }
    }
    return offenders;
}

const offenders = check();
if (offenders.length > 0) {
    console.error('Found overlay-shaped markup without useOverlayBehavior (Escape/outside-click/back-button support):\n');
    offenders.forEach((f) => console.error(`  - src/${f}`));
    console.error('\nEither call useOverlayBehavior(open, onClose) directly, or render the shared <Modal> component instead.');
    console.error('If this is a deliberate, already-tracked exception, add it to KNOWN_EXCEPTIONS in scripts/check-overlay-behavior.js with a reason.');
    process.exit(1);
} else {
    console.log('All overlay-shaped markup wires up useOverlayBehavior (directly or via <Modal>).');
}
