import React, { useEffect, useState } from 'react';
import { Check, MessagesSquare, Moon, Search, Sun } from 'lucide-react';
import { Modal } from '../ui';
import { useTheme, setStoredMode, setStoredPalette } from '../../theme/ThemeContext';
import { PALETTES, PALETTE_KEYS } from '../../theme/palettes';
import { ANSWER_FORMAT_OPTIONS, setStoredAnswerFormat } from '../../config/chatConfig';
import { setStoredChatDefaultCategories, setStoredKhojDefaultCategories } from '../../config/filterDefaults';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../services/api';
import CategoryChips from '../CategoryChips';

// Bigger, colored, icon-led product name + a divider above it is what carries
// the hierarchy here — no card/box needed, so the field labels below (which
// are deliberately small and muted, see FieldLabel) never get confused for
// another one of these.
function SectionHeader({ icon: Icon, colorVar, children }) {
    return (
        <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
            <Icon size={20} style={{ color: `var(${colorVar})` }} />
            <span className="text-base font-semibold" style={{ color: `var(${colorVar})` }}>{children}</span>
        </div>
    );
}

function FieldLabel({ children }) {
    return (
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">{children}</div>
    );
}

// Everything here — theme mode/color, answer type, and each product's default
// filter — is a local draft until Save. Nothing touches the live app (or the
// active chat session, or an in-progress Aagam Khoj search) just from
// clicking around the panel; closing without saving discards the draft with
// no side effects, since nothing was ever applied.
export default function SettingsModal({
    open,
    onClose,
    answerFormat,
    onSaveAnswerFormat,
    activeCategories = ['Pravachan', 'Granth'],
    chatDefaultCategories,
    onSaveChatDefaultCategories,
    khojDefaultCategories,
    onSaveKhojDefaultCategories,
}) {
    const { user, refreshSettings } = useAuth();
    const { mode, setMode, palette, setPalette } = useTheme();
    const [draftMode, setDraftMode] = useState(mode);
    const [draftPalette, setDraftPalette] = useState(palette);
    const [draftFormat, setDraftFormat] = useState(answerFormat);
    const [draftChatCategories, setDraftChatCategories] = useState(() => chatDefaultCategories || activeCategories);
    const [draftKhojCategories, setDraftKhojCategories] = useState(() => khojDefaultCategories || activeCategories);

    // Re-sync every draft to whatever's actually active/saved each time the
    // modal opens — otherwise closing without saving, then reopening, would
    // show stale drafts from the abandoned attempt instead of the real
    // values. All five already live in memory (App.js/ThemeContext), kept
    // current regardless of login state, so no fetch is needed here.
    useEffect(() => {
        if (open) {
            setDraftMode(mode);
            setDraftPalette(palette);
            setDraftFormat(answerFormat);
            setDraftChatCategories(chatDefaultCategories || activeCategories);
            setDraftKhojCategories(khojDefaultCategories || activeCategories);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode, palette, answerFormat, chatDefaultCategories, khojDefaultCategories]);

    const formatChanged = draftFormat !== answerFormat;

    const handleSave = () => {
        // Always apply to in-memory state — these calls never persist
        // anything themselves anymore (see ThemeContext.js/App.js), they
        // just update what's currently rendered/used.
        setMode(draftMode);
        setPalette(draftPalette);
        if (formatChanged) onSaveAnswerFormat(draftFormat);
        // These two only seed the *next* new chat session / Aagam Khoj page
        // load — saving never touches whatever's currently active, so there's
        // no harm (and no session-ending warning needed) in always calling
        // through, changed or not.
        onSaveChatDefaultCategories?.(draftChatCategories);
        onSaveKhojDefaultCategories?.(draftKhojCategories);

        if (user) {
            // Logged in: persist to the server so it follows the account
            // across devices. Fire-and-forget — in-memory state is already
            // updated above regardless of network outcome, so a failed sync
            // only means it won't show up on a different device yet, not a
            // lost local setting (mirrors AuthContext.login's best-effort
            // mergeAnonymousSessions call).
            api.updateSettings({
                mode: draftMode,
                palette: draftPalette,
                answerFormat: draftFormat,
                chatDefaultCategories: draftChatCategories,
                khojDefaultCategories: draftKhojCategories,
            })
                // Feed the saved value back into AuthContext so a later
                // settings-sync re-run (e.g. once admin config resolves)
                // can't revert this save by re-applying the stale value it
                // still had cached.
                .then((res) => refreshSettings(res.settings))
                .catch((err) => console.warn('Could not sync settings to server', err));
        } else {
            // Logged out: today's localStorage persistence, now explicit
            // here instead of implicit inside ThemeContext's setters.
            // Persisted unconditionally like the other four fields (writing
            // the same value again is harmless) -- formatChanged above only
            // gates the chat-session-ending side effect, not persistence.
            setStoredMode(draftMode);
            setStoredPalette(draftPalette);
            setStoredAnswerFormat(draftFormat);
            setStoredChatDefaultCategories(draftChatCategories);
            setStoredKhojDefaultCategories(draftKhojCategories);
        }

        onClose();
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Settings"
            size="md"
            // closeOnBack=false: see LogoutConfirmModal.js.
            closeOnBack={false}
            footer={
                <button onClick={handleSave} className="btn btn-primary">
                    Save
                </button>
            }
        >
            <div className="space-y-6">
                <div>
                    <FieldLabel>Theme</FieldLabel>
                    <div className="flex items-center gap-4">
                        <div
                            className="inline-flex rounded-full p-1"
                            style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                            role="radiogroup"
                            aria-label="Light or dark mode"
                        >
                            <button
                                type="button"
                                role="radio"
                                aria-checked={draftMode === 'light'}
                                onClick={() => setDraftMode('light')}
                                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                                style={draftMode === 'light'
                                    ? { backgroundColor: 'var(--color-brand)', color: 'var(--color-surface)' }
                                    : { color: 'var(--color-ink-muted)' }}
                                title="Light"
                            >
                                <Sun size={13} />
                            </button>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={draftMode === 'dark'}
                                onClick={() => setDraftMode('dark')}
                                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                                style={draftMode === 'dark'
                                    ? { backgroundColor: 'var(--color-brand)', color: 'var(--color-surface)' }
                                    : { color: 'var(--color-ink-muted)' }}
                                title="Dark"
                            >
                                <Moon size={13} />
                            </button>
                        </div>

                        <div className="flex items-center gap-2" role="radiogroup" aria-label="Theme color">
                            {PALETTE_KEYS.map((key) => {
                                const swatchColor = PALETTES[key][draftMode]['--color-brand'];
                                const selected = draftPalette === key;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() => setDraftPalette(key)}
                                        title={PALETTES[key].label}
                                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                                        style={{
                                            backgroundColor: swatchColor,
                                            boxShadow: selected ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${swatchColor}` : 'none',
                                        }}
                                    >
                                        {selected && <Check size={13} color="var(--color-surface)" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <SectionHeader icon={MessagesSquare} colorVar="--color-mark">Swalakshya AI</SectionHeader>

                    <div>
                        <FieldLabel>Answer type</FieldLabel>
                        <div className="flex flex-col sm:flex-row gap-2" role="radiogroup" aria-label="Answer type">
                            {ANSWER_FORMAT_OPTIONS.map((opt) => {
                                const selected = draftFormat === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() => setDraftFormat(opt.value)}
                                        className="flex-1 rounded-lg px-3 py-2.5 text-left cursor-pointer"
                                        style={{
                                            border: selected ? '1.5px solid var(--color-brand)' : '1px solid var(--color-border)',
                                            backgroundColor: selected ? 'color-mix(in srgb, var(--color-brand) 6%, var(--color-surface))' : 'var(--color-surface)',
                                        }}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <opt.icon size={15} style={{ color: selected ? 'var(--color-brand)' : 'var(--color-ink-muted)' }} />
                                            <span className="text-sm font-medium text-ink">{opt.label}</span>
                                        </div>
                                        <div className="text-xs text-ink-muted mt-0.5">{opt.description}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {formatChanged && (
                            <div
                                className="mt-3 text-xs rounded px-3 py-2"
                                style={{
                                    backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-surface))',
                                    border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)',
                                    color: 'var(--color-warning)',
                                }}
                            >
                                Saving this will end your current chat session.
                            </div>
                        )}
                    </div>

                    <div>
                        <FieldLabel>Default filter type</FieldLabel>
                        <CategoryChips
                            categories={activeCategories}
                            selected={draftChatCategories}
                            onChange={setDraftChatCategories}
                            compact
                            align="left"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <SectionHeader icon={Search} colorVar="--color-brand">Aagam Khoj</SectionHeader>

                    <div>
                        <FieldLabel>Default filter type</FieldLabel>
                        <CategoryChips
                            categories={activeCategories}
                            selected={draftKhojCategories}
                            onChange={setDraftKhojCategories}
                            compact
                            align="left"
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
}
