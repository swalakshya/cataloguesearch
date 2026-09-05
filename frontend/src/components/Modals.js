import React from 'react';
import { Modal } from './ui';

// Granth name + optional author line, used as the header title for both the
// verse and prose modals below — kept as inline elements (not <div>s) since
// Modal renders `title` inside an <h2>.
function GranthTitle({ granthName, metadata }) {
    return (
        <span className="flex flex-col items-start">
            <span>{granthName}</span>
            {metadata && metadata.author && (
                <span className="text-sm font-normal text-ink-muted mt-0.5">Author: {metadata.author}</span>
            )}
        </span>
    );
}

// --- MODAL COMPONENTS ---
// Each of these is only ever mounted by its parent while "open" (there's no
// separate open prop), so `open` is always true here — the shared Modal
// component (Escape/outside-click/X/back-button, all via useOverlayBehavior)
// handles the rest; only the content below is specific to each one.
export const GranthVerseModal = ({ verse, granthName, metadata, onClose, isLoading }) => {
    return (
        <Modal open onClose={onClose} title={<GranthTitle granthName={granthName} metadata={metadata} />} size="lg" accentColorVar="--color-info">
            {isLoading ? (
                <div className="text-center py-10">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
                    <p className="mt-3 text-base text-slate-500">Loading verse...</p>
                </div>
            ) : verse ? (
                <div className="space-y-4">
                    {/* Verse Header Info */}
                    <div className="flex items-center gap-3 flex-wrap border-b border-slate-200 pb-3">
                        <div className="inline-block bg-sky-100 text-sky-800 text-sm font-semibold px-3 py-1 rounded">
                            {verse.adhikar && (
                                <span>Adhikar: {verse.adhikar}</span>
                            )}
                            {verse.adhikar && verse.type && verse.type_start_num !== undefined && verse.type_end_num !== undefined && (
                                <span> | </span>
                            )}
                            {verse.type && verse.type_start_num !== undefined && verse.type_end_num !== undefined && (
                                <span>
                                    {verse.type}: {verse.type_start_num === verse.type_end_num
                                        ? verse.type_start_num
                                        : `${verse.type_start_num}-${verse.type_end_num}`}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Verse Content */}
                    {verse.verse && verse.verse.trim() && (
                        <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                            <p className="text-lg font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                                {verse.verse}
                            </p>
                        </div>
                    )}

                    {/* Translation */}
                    {verse.translation && verse.translation.trim() && (
                        <div className="bg-white border border-slate-200 rounded-lg p-4">
                            <p className="text-sm font-bold text-slate-700 mb-2">Translation:</p>
                            <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {verse.translation}
                            </p>
                        </div>
                    )}

                    {/* Meaning */}
                    {verse.meaning && verse.meaning.trim() && (
                        <div className="bg-white border border-slate-200 rounded-lg p-4">
                            <p className="text-sm font-bold text-slate-700 mb-2">Meaning:</p>
                            <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {verse.meaning}
                            </p>
                        </div>
                    )}

                    {/* Teeka */}
                    {verse.teeka && (Array.isArray(verse.teeka) ? verse.teeka.length > 0 : verse.teeka.trim()) && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <p className="text-sm font-bold text-amber-900 mb-2">Teeka:</p>
                            <div className="space-y-2">
                                {Array.isArray(verse.teeka) ? (
                                    verse.teeka.map((t, idx) => (
                                        <p key={idx} className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                            {t}
                                        </p>
                                    ))
                                ) : (
                                    <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                        {verse.teeka}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Bhavarth */}
                    {verse.bhavarth && (Array.isArray(verse.bhavarth) ? verse.bhavarth.length > 0 : verse.bhavarth.trim()) && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <p className="text-sm font-bold text-green-900 mb-2">Bhavarth:</p>
                            <div className="space-y-2">
                                {Array.isArray(verse.bhavarth) ? (
                                    verse.bhavarth.map((b, idx) => (
                                        <p key={idx} className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                            {b}
                                        </p>
                                    ))
                                ) : (
                                    <p className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                        {verse.bhavarth}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-10 text-slate-500">
                    <p>Verse data not available.</p>
                </div>
            )}
        </Modal>
    );
};

export const GranthProseModal = ({ prose, granthName, metadata, onClose, isLoading }) => {
    return (
        <Modal open onClose={onClose} title={<GranthTitle granthName={granthName} metadata={metadata} />} size="lg" accentColorVar="--color-success">
            {isLoading ? (
                <div className="text-center py-10">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                    <p className="mt-3 text-base text-slate-500">Loading prose...</p>
                </div>
            ) : prose ? (
                <div className="space-y-4">
                    {/* Prose Header Info - Breadcrumb */}
                    <div className="flex items-center gap-3 flex-wrap border-b border-slate-200 pb-3">
                        <div className="inline-block bg-emerald-100 text-emerald-800 text-sm font-semibold px-3 py-1 rounded">
                            {prose.adhikar && (
                                <span>{prose.adhikar}</span>
                            )}
                            {prose.adhikar && prose.parent_heading && (
                                <span className="mx-2">›</span>
                            )}
                            {prose.parent_heading && (
                                <span>{prose.parent_heading}</span>
                            )}
                            {prose.parent_heading && prose.heading && (
                                <span className="mx-2">›</span>
                            )}
                            {prose.heading && !prose.parent_heading && prose.adhikar && (
                                <span className="mx-2">›</span>
                            )}
                            {prose.heading && (
                                <span>{prose.heading}</span>
                            )}
                        </div>
                    </div>

                    {/* Main Content Paragraphs */}
                    {prose.content && prose.content.length > 0 && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                            <div className="space-y-3">
                                {prose.content.map((para, index) => (
                                    <p key={index} className="text-base text-slate-700 leading-relaxed whitespace-pre-wrap">
                                        {para}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Subsections */}
                    {prose.subsections && prose.subsections.length > 0 && (
                        <div className="space-y-3">
                            <p className="text-sm font-bold text-slate-700">Subsections:</p>
                            {prose.subsections.map((subsection, subIndex) => (
                                <div key={subIndex} className="bg-white border border-emerald-200 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-emerald-100">
                                        <span className="text-sm font-semibold text-emerald-700">{subsection.heading}</span>
                                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">#{subsection.seq_num}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {subsection.content && subsection.content.map((para, paraIndex) => (
                                            <p key={paraIndex} className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                                {para}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-10 text-slate-500">
                    <p>Prose data not available.</p>
                </div>
            )}
        </Modal>
    );
};

export const ExpandModal = ({ data, onClose, isLoading }) => {
    const Paragraph = ({ para, isCurrent }) => {
        if (!para) {
            return (
                <div className="p-3 rounded-md bg-slate-50 border border-dashed border-slate-300 text-center text-sm text-slate-400">
                    Context not available.
                </div>
            );
        }
        return (
            <div className={`p-3 rounded-md ${
                isCurrent
                    ? "bg-sky-100 border border-sky-300 ring-2 ring-sky-200"
                    : "bg-slate-50 border border-slate-200"
            }`}>
                <p className="text-slate-800 leading-relaxed text-base font-sans whitespace-pre-wrap">
                    {para.content_snippet}
                </p>
            </div>
        );
    };

    return (
        <Modal open onClose={onClose} title="Expanded Context" size="md" accentColorVar="--color-info">
            {isLoading ? (
                <div className="text-center py-10">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
                    <p className="mt-3 text-base text-slate-500">Loading Context...</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <Paragraph para={data?.previous} />
                    <Paragraph para={data?.current} isCurrent={true} />
                    <Paragraph para={data?.next} />
                </div>
            )}
        </Modal>
    );
};

export const WelcomeModal = ({ onClose, onGoToUsageGuide }) => {
    // No title passed — the heading lives inside the centered body content
    // below, matching the original design; Modal still shows its header bar
    // with just the X button, since `onClose` alone is enough to trigger it.
    return (
        <Modal open onClose={onClose} size="sm">
            <div className="text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-sky-100 mb-4">
                    <span className="text-2xl">🙏😊</span>
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Welcome to Swalakshya Chat!</h2>
                <p className="text-slate-600 text-base leading-relaxed mb-6">
                    Please go through the "Usage Guide" to use this platform effectively.
                </p>
                <div className="flex flex-col space-y-3">
                    <button
                        onClick={onGoToUsageGuide}
                        className="w-full bg-sky-600 text-white font-semibold py-3 px-4 rounded-md hover:bg-sky-700 transition duration-300"
                    >
                        Go to Usage Guide
                    </button>
                    <button
                        onClick={onClose}
                        className="w-full bg-slate-200 text-slate-700 font-semibold py-3 px-4 rounded-md hover:bg-slate-300 transition duration-300"
                    >
                        Skip
                    </button>
                </div>
            </div>
        </Modal>
    );
};
