import React from 'react';
import {
    Loader2,
    ChevronUp,
    ChevronDown,
    LayoutGrid,
    Maximize2,
    Menu,
    X,
    Send,
    Info,
    Share2,
    Download,
} from 'lucide-react';

// --- HELPER & ICON COMPONENTS ---
// Thin wrappers around lucide-react, keeping the original export names/sizing
// so every existing call site keeps working unchanged.
export const Spinner = () => <Loader2 className="h-4 w-4 animate-spin" />;

export const ChevronUpIcon = () => <ChevronUp className="h-4 w-4 mr-1.5" />;

export const ChevronDownIcon = () => <ChevronDown className="h-4 w-4 mr-1.5" />;

export const SimilarIcon = () => <LayoutGrid className="h-4 w-4 mr-1" />;

export const ExpandIcon = () => <Maximize2 className="h-4 w-4 mr-1" />;

// No lucide equivalent for a "PDF" document badge glyph — kept custom.
export const PdfIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 24 24" aria-hidden="true">
        <path
            fill="#fff"
            d="M5 2h10.5L21 7.5V19a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z"
        />
        <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M5 2h10.5L21 7.5V19a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z"
        />
        <path
            fill="#ffd6d6"
            d="M15.5 2v5.5H21Z"
        />
        <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M15.5 2v5.5H21"
        />
        <path
            d="M8.3 14.9c1.5-1.4 3.1-4.6 3.8-6.8c.15-.46.32-.68.52-.68c.42 0 .62.54.62 1.63c0 1.4-.36 3.23-1.04 5.03c2.06-.4 3.92-.28 4.9.34c.55.35.58.87.08 1.12c-.48.24-1.16.36-2.01.36c-1.29 0-2.87-.28-4.42-.79c-.56.95-1.15 1.8-1.74 2.46c-.63.72-1.26 1.08-1.88 1.08c-.64 0-1-.31-1-.84c0-.68.7-1.62 2.19-2.73Zm3.6-.56c-1.1-.41-2.01-.83-2.53-1.16c-.94.79-1.45 1.4-1.45 1.77c0 .12.07.18.2.18c.42 0 1.46-.95 2.74-2.49Zm.82-1.48c1.24.26 2.35.38 3.24.38c.62 0 .95-.06.95-.17c0-.18-.75-.42-1.93-.42c-.61 0-1.36.07-2.26.21Zm-.02-1.58c.33-1.02.5-1.98.5-2.74c0-.52-.04-.78-.12-.78c-.16 0-.52 1.11-1.19 3.37c.28.07.56.12.81.15Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <text
            x="12"
            y="20.05"
            textAnchor="middle"
            fontSize="4.8"
            fontWeight="700"
            letterSpacing="0.6"
            fill="currentColor"
            fontFamily="Arial, Helvetica, sans-serif"
        >
            PDF
        </text>
    </svg>
);

export const BetaBadge = () => (
    <span
        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full ml-2"
        style={{ backgroundColor: 'var(--color-warning)', color: '#fff', opacity: 0.9 }}
    >
        BETA
    </span>
);

export const MenuIcon = () => <Menu className="h-6 w-6" />;

export const CloseIcon = () => <X className="h-6 w-6" />;

export const SubmitIcon = () => <Send className="h-5 w-5 mr-2" />;

export const InformationCircleIcon = () => (
    <Info className="h-5 w-5 text-ink-muted hover:text-ink cursor-pointer" />
);

export const ShareIcon = () => <Share2 className="h-4 w-4 mr-1" />;

export const DownloadIcon = () => <Download className="h-4 w-4 mr-1" />;
