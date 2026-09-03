import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MessagesSquare } from 'lucide-react';
import { PageHeader } from './ui';
import StatsStrip from './chat/StatsStrip';

// AI first, Khoj second.
const CARDS = [
    {
        id: 'chat',
        to: '/chat',
        icon: MessagesSquare,
        accentVar: '--color-mark',
        title: 'Swalakshya AI',
        description: 'Ask questions about Jain Philosophy and Adhyatm.\nClear answers grounded in scriptures.\nExact page and chapter references behind every answer.',
        placeholder: 'Ask anything about Jain philosophy, scriptures, or teachings...',
        button: 'Chat with Swalakshya',
    },
    {
        id: 'aagam-khoj',
        to: '/aagam-khoj',
        icon: Search,
        accentVar: '--color-brand',
        title: 'Swalakshya Khoj',
        description: 'Search by keyword or by meaning.\nGet the exact scriptural references.\nIdeal for deep study, research, citations.',
        placeholder: 'Search by keyword or topic…',
        button: 'Khoj with Swalakshya',
    },
];

// Same gradient used across the boxes below the action cards — brand (Khoj)
// into mark (Chat) — so they read as one connected set tied to both cards
// above, rather than a standalone extra.
const ACCENT_GRADIENT = 'linear-gradient(to right, var(--color-brand), var(--color-mark))';

// Fuller phrasing than StatsStrip's default tile labels, since this is the
// first thing a visitor sees rather than a quick reference strip.
const HOME_STATS_LABELS = {
    Granth: 'Authentic Jain Scriptures',
    Pravachan: 'Pravachans by Pujya Gurudevshri Kanji Swami',
    Curated: 'Literature by Esteemed Jain Scholars',
};

function HomeActionCard({ card, setCurrentPage, onSubmit }) {
    const [value, setValue] = useState('');
    const { id, to, icon: Icon, accentVar, title, description, placeholder, button } = card;

    const handleSubmit = (e) => {
        e.preventDefault();
        const text = value.trim();
        if (!text) return;
        onSubmit(text);
    };

    return (
        <div className="card p-6 shadow-sm" style={{ borderTop: `4px solid var(${accentVar})` }}>
            <Link to={to} onClick={() => setCurrentPage(id)} className="block">
                <div className="flex items-center gap-3 mb-3 sm:block sm:mb-0">
                    <div
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 sm:mb-4"
                        style={{ backgroundColor: `color-mix(in srgb, var(${accentVar}) 14%, var(--color-surface))` }}
                    >
                        <Icon size={22} style={{ color: `var(${accentVar})` }} />
                    </div>
                    <h3 className="text-xl font-bold sm:mb-2" style={{ color: `var(${accentVar})` }}>{title}</h3>
                </div>
                <p className="text-ink-muted text-sm leading-relaxed mb-5 whitespace-pre-line">{description}</p>
            </Link>
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
                <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    aria-label={title}
                    className="field flex-1"
                />
                <button type="submit" className="btn btn-primary whitespace-nowrap">
                    {button}
                </button>
            </form>
        </div>
    );
}

export default function Home({ setCurrentPage, onKhojSubmit, onChatSubmit }) {
    const submitHandlers = { chat: onChatSubmit, 'aagam-khoj': onKhojSubmit };

    return (
        <div className="max-w-[1080px] mx-auto">
            <PageHeader
                variant="hero"
                title="Swalakshya"
                subtitle={'Search through Authentic Digambar Jain scriptures.\nDiscover deeper meaning.\nAsk what matters.'}
            />

            <div className="flex flex-col gap-6">
                {CARDS.map((card) => (
                    <HomeActionCard
                        key={card.id}
                        card={card}
                        setCurrentPage={setCurrentPage}
                        onSubmit={submitHandlers[card.id]}
                    />
                ))}

                <StatsStrip topAccent={ACCENT_GRADIENT} spacious labels={HOME_STATS_LABELS} />
            </div>
        </div>
    );
}
