import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
    MessageSquare,
    MoreVertical,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Plus,
    Settings,
    Trash2,
    User,
    X,
} from 'lucide-react';
import { useOverlayBehavior } from '../ui/Modal';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../services/api';
import { useInlineConfirm } from '../../hooks/useInlineConfirm';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import AnonLoginAvatar from '../auth/AnonLoginAvatar';
import LoggedInAccountRow from '../auth/LoggedInAccountRow';
import { ALL_NAV_ITEMS } from './navItems';
import swalakshyaMark from '../../assets/swalakshya-mark.png';

const HISTORY_POLL_INTERVAL_MS = 30_000;
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'; // matches Tailwind's `lg` breakpoint

// The desktop persistent sidebar stays MOUNTED below `lg` (only CSS-hidden
// via `hidden lg:flex`), so its HistoryList was polling every 30s even while
// invisible -- and, if the mobile drawer was also open at a narrow
// viewport, a second independent HistoryList (with its own poll and its own
// `sessions` state) ran alongside it. This tells the desktop instance to
// stop fetching/polling while it isn't actually the visible one.
function useIsDesktopViewport() {
    const [isDesktop, setIsDesktop] = useState(() => (
        typeof window !== 'undefined' ? window.matchMedia(DESKTOP_MEDIA_QUERY).matches : true
    ));
    useEffect(() => {
        const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
        const onChange = () => setIsDesktop(mql.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);
    return isDesktop;
}

const COLLAPSE_KEY = 'sidebar_collapsed';

// The brand mark, extracted from the existing meditating-figure logo (its
// baked-in gradient circle + text stripped out — see swalakshya-mark.png).
// Applied as a CSS mask rather than a plain <img> so it tints with the brand
// token and follows whichever palette/dark-mode state is active, instead of
// being a static white shape that would vanish on a light background.
function BrandMark({ size = 22 }) {
    return (
        <div
            aria-hidden="true"
            style={{
                width: size,
                height: size,
                flexShrink: 0,
                backgroundColor: 'var(--color-mark, var(--color-brand))',
                WebkitMaskImage: `url(${swalakshyaMark})`,
                maskImage: `url(${swalakshyaMark})`,
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
            }}
        />
    );
}

// Page nav links, shown only inside the mobile drawer — the desktop TopBar
// already carries these above the `lg` breakpoint.
function MobileNavLinks({ currentPage, setCurrentPage, onNavigate }) {
    const location = useLocation();
    const isActive = (item) => {
        if (item.id === 'home') return location.pathname === '/' && currentPage === item.id;
        return location.pathname === item.path;
    };
    return (
        <div className="px-3 pb-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {ALL_NAV_ITEMS.map((item) => (
                <Link
                    key={item.id}
                    to={item.path}
                    onClick={() => { setCurrentPage(item.id); onNavigate(); }}
                    className="block px-2 py-2 text-sm font-medium rounded-md"
                    style={isActive(item)
                        ? { color: 'var(--color-brand)', backgroundColor: 'color-mix(in srgb, var(--color-brand) 12%, var(--color-surface))', fontWeight: 600 }
                        : { color: 'var(--color-ink-muted)' }}
                >
                    {item.label}
                </Link>
            ))}
        </div>
    );
}

// Avatar circle shared by every UserRow state — a photo when Google gave us
// one, otherwise a generic person glyph (also what a still-loading, failed-
// to-load, or logged-out state shows).
export function Avatar({ user }) {
    const [imgFailed, setImgFailed] = useState(false);
    const showPhoto = user?.avatar_url && !imgFailed;
    return (
        <div
            className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--color-bg)' }}
        >
            {showPhoto ? (
                <img
                    src={user.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                    // Google's profile-picture CDN (lh3.googleusercontent.com) can
                    // refuse the request based on the Referer header a plain <img>
                    // sends by default -- this drops it, which is the documented
                    // fix. onError still falls back to the plain icon for any other
                    // reason it fails (network blip, revoked photo, etc).
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                />
            ) : (
                <User size={16} className="text-ink-muted" />
            )}
        </div>
    );
}

// The sidebar's bottom-left identity slot. Collapsed (96px wide) has no room
// for a name or Google's button, so it always falls back to an avatar-only
// circle regardless of login state; expanded shows the real Google Sign-In
// button when logged out, or the account's name + a sign-out affordance
// once logged in.
function UserRow({ collapsed }) {
    const { user, logout } = useAuth();

    if (!user) {
        return <AnonLoginAvatar showLabel={!collapsed} />;
    }

    if (collapsed) {
        return <Avatar user={user} />;
    }

    return <LoggedInAccountRow user={user} logout={logout} nameClassName="flex-1 min-w-0" />;
}

// Rows created before session_store.js's own TITLE_MAX_LENGTH was shortened
// (see cataloguesearch-chat) can still carry a much longer title already
// saved in the DB. The row renders as one no-wrap line, where a title this
// long (~900px of mixed Devanagari/Latin text at 120 chars) needs more
// width than CSS truncate alone reliably contains -- it was dragging the
// whole sidebar wider instead of eliding, since a grid/flex item's default
// min-width is its content's min-content size (see the sidebar's own
// min-w-0 fix). Hard-capping the row's OWN text client-side, independent of
// however long the stored title is, makes the row safe regardless of
// what's already in the database. Note the tooltip below isn't actually
// showing "the real, un-capped" title in any meaningful sense anymore --
// the backend now truncates at the same length (TITLE_MAX_LENGTH=60) when
// the title is first derived/renamed, so there's no longer a longer
// original anywhere to reveal; it exists mainly to cover legacy rows saved
// before that backend change, which can still be longer than this cap.
const ROW_TITLE_MAX_CHARS = 60;
function capTitleForRow(title) {
    if (title.length <= ROW_TITLE_MAX_CHARS) return title;
    return `${title.slice(0, ROW_TITLE_MAX_CHARS)}…`;
}

// The three-dot menu's popover — Rename (hands off to the row's own inline
// input) and Delete (an inline "are you sure" swapped into this same popover
// via useInlineConfirm, instead of a native window.confirm — see
// LoggedInAccountRow.js for the sibling use of the same hook).
function HistoryRowMenu({ onRename, onDelete, onClose, toggleRef }) {
    const menuRef = useRef(null);
    const { confirming, requestConfirm, confirm, cancel, containerRef } = useInlineConfirm(onDelete);

    // Both menuRef (the popover itself) and toggleRef (the three-dot button
    // that opened it) count as "inside" -- toggleRef is a SIBLING of this
    // menu, not an ancestor, so without including it here, clicking the
    // toggle while the menu is open would fight its own onClick handler:
    // this hook's mousedown listener would see the click as outside and
    // close the menu, then the button's own onClick would fire and flip the
    // now-closed state back open, so the menu could never be closed via the
    // button that opened it.
    useOutsideClick([menuRef, toggleRef], onClose);

    return (
        <div
            ref={menuRef}
            className="absolute right-1 top-full mt-1 w-44 z-20 rounded-md shadow-lg py-1"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
            {confirming ? (
                <div ref={containerRef} className="px-3 py-2">
                    <div className="text-xs text-ink-muted mb-2">Delete this chat?</div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={cancel}
                            className="flex-1 text-xs font-medium rounded-md py-1 hover:bg-bg"
                            style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)' }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirm}
                            className="flex-1 text-xs font-medium rounded-md py-1"
                            style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <button
                        onClick={onRename}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg"
                        style={{ color: 'var(--color-ink)' }}
                    >
                        <Pencil size={14} /> Rename
                    </button>
                    <button
                        onClick={requestConfirm}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg"
                        style={{ color: 'var(--color-danger)' }}
                    >
                        <Trash2 size={14} /> Delete
                    </button>
                </>
            )}
        </div>
    );
}

// One history row — truncated to a single line (min-w-0 is what actually
// makes `truncate` take effect on a flex child; without it the title just
// keeps growing and spills out past the sidebar's edge instead of eliding).
// Hovering shows the full title in the app's existing tooltip-bubble style
// (see components.css, already used the same way elsewhere for hint text)
// rather than the slow/plain native browser tooltip.
//
// The three-dot menu button is a SIBLING of the "open chat" button, not
// nested inside it -- nested <button>s are invalid HTML and break click
// handling. `group` on the outer wrapper lets the dot fade in on row hover
// (`lg:group-hover`) while staying always-visible below the `lg` breakpoint
// (no hover concept on touch), matching ChatGPT's sidebar.
function HistoryRow({ session, onOpen, onRename, onDelete }) {
    const [showTooltip, setShowTooltip] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');
    const toggleRef = useRef(null);
    // Escape must WIN over the input's own onBlur commit -- removing the
    // focused input from the DOM (what setRenaming(false) does, since
    // `renaming` gates which JSX branch renders) fires a native blur on the
    // way out, which onBlur={commitRename} would otherwise still act on,
    // silently saving the exact edit the user just pressed Escape to
    // discard. This flag, set synchronously before the state update, tells
    // the blur handler to skip committing this one time.
    const cancellingRef = useRef(false);
    const title = session.title || 'New conversation';
    const rowTitle = capTitleForRow(title);

    const startRename = () => {
        setMenuOpen(false);
        setDraftTitle(session.title || '');
        setRenaming(true);
    };

    const commitRename = () => {
        if (cancellingRef.current) {
            cancellingRef.current = false;
            return;
        }
        setRenaming(false);
        const trimmed = draftTitle.trim();
        if (trimmed && trimmed !== session.title) onRename(trimmed);
    };

    const cancelRename = () => {
        cancellingRef.current = true;
        setRenaming(false);
    };

    if (renaming) {
        return (
            <div className="px-1 py-1">
                <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        else if (e.key === 'Escape') cancelRename();
                    }}
                    className="w-full text-sm text-ink bg-transparent rounded-md px-1.5 py-1 outline-none"
                    style={{ border: '1px solid var(--color-brand)' }}
                />
            </div>
        );
    }

    return (
        <div className="relative group">
            <div className="flex items-center min-w-0 rounded-md hover:bg-bg">
                <button
                    onClick={onOpen}
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                    onFocus={() => setShowTooltip(true)}
                    onBlur={() => setShowTooltip(false)}
                    className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 text-left"
                >
                    <MessageSquare size={14} className="text-ink-muted shrink-0" />
                    <span className="text-sm text-ink flex-1 min-w-0 truncate">{rowTitle}</span>
                </button>
                <button
                    ref={toggleRef}
                    onClick={() => setMenuOpen((open) => !open)}
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity p-1 mr-1 rounded text-ink-muted hover:text-ink hover:bg-bg shrink-0"
                    title="Chat options"
                    aria-label="Chat options"
                >
                    <MoreVertical size={14} />
                </button>
            </div>
            {menuOpen && (
                <HistoryRowMenu
                    toggleRef={toggleRef}
                    onRename={startRename}
                    onDelete={onDelete}
                    onClose={() => setMenuOpen(false)}
                />
            )}
            {showTooltip && !menuOpen && (
                <div className="tooltip-bubble absolute left-1 top-full mt-1 rounded px-2 py-1 z-10 text-xs max-w-[220px] whitespace-normal break-words">
                    {title}
                </div>
            )}
        </div>
    );
}

// The chat rail's "History" section — a compact list of past conversations,
// titled by each session's first question (set server-side, see
// cataloguesearch-chat's session_store.js). Clicking a row navigates to
// /chat carrying the session id as router state; ChatPage's mount effect
// picks that up and loads the full transcript from the server instead of
// resuming from localStorage. refreshKey is bumped by ChatPage (via App.js)
// whenever a session is created or changes, since a plain sibling component
// otherwise has no way to know a new chat just happened.
function HistoryList({ refreshKey, active = true }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState(null);
    const [error, setError] = useState(false);
    // Counts in-flight rename/delete calls. The silent background poll
    // checks this at apply time (not just before firing) -- a poll request
    // that was already in flight when a rename/delete started would
    // otherwise resolve with pre-edit data right after the optimistic
    // update and silently revert it.
    const pendingMutationsRef = useRef(0);

    // Mount / refreshKey bump does a real (loading-flashing, error-surfacing)
    // fetch; a 30s background poll on top of that keeps this list from going
    // stale if another tab/device renamed, deleted or added a conversation --
    // full cross-tab sync is future work, this is a cheap stopgap. The poll
    // is silent (never touches `error`/resets `sessions` to null first, so it
    // never flickers "Loading…" over a list someone might be reading), paused
    // entirely while the tab isn't visible, and reset (via the `refreshKey`
    // dependency below) whenever a same-tab action already refreshed it, so
    // it's "at least every 30s of idle" rather than two refreshes racing.
    useEffect(() => {
        if (!user || !active) {
            if (!user) setSessions(null);
            return undefined;
        }

        let cancelled = false;
        let intervalId = null;

        const load = (silent) => {
            if (silent && pendingMutationsRef.current > 0) return; // a rename/delete is already in flight -- don't bother
            if (!silent) setError(false);
            api.listChatSessions(user.id)
                .then(({ sessions: list }) => {
                    if (cancelled) return;
                    if (silent && pendingMutationsRef.current > 0) return; // re-check: a mutation may have started while this was in flight
                    setSessions(list);
                    setError(false);
                })
                .catch(() => { if (!cancelled && !silent) setError(true); });
        };

        const stopPolling = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };
        const startPolling = () => {
            stopPolling();
            intervalId = setInterval(() => load(true), HISTORY_POLL_INTERVAL_MS);
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                load(true);
                startPolling();
            } else {
                stopPolling();
            }
        };

        load(false); // the explicit refresh this effect exists for (mount or refreshKey bump)
        if (document.visibilityState === 'visible') startPolling();
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            cancelled = true;
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [user, refreshKey, active]);

    // Rename/delete update the local list directly (no refetch needed) --
    // optimistically, since both are single deliberate actions where an
    // instant-feeling response matters more than waiting on the round trip,
    // rolling back to the pre-action list if the API call fails. Tracks the
    // mutation in pendingMutationsRef so the background poll above won't
    // clobber it with stale data.
    const applyOptimistic = (mutate, promise, errorLabel) => {
        const previous = sessions;
        setSessions(mutate);
        pendingMutationsRef.current += 1;
        promise
            .catch((err) => {
                console.error(errorLabel, err);
                setSessions(previous);
            })
            .finally(() => {
                pendingMutationsRef.current -= 1;
            });
    };

    const handleRename = (sessionId, newTitle) => {
        applyOptimistic(
            (prev) => prev.map((s) => (s.session_id === sessionId ? { ...s, title: newTitle } : s)),
            api.renameChatSession(sessionId, newTitle),
            'Could not rename chat session'
        );
    };

    const handleDelete = (sessionId) => {
        applyOptimistic(
            (prev) => prev.filter((s) => s.session_id !== sessionId),
            api.deleteChatSession(sessionId),
            'Could not delete chat session'
        );
    };

    if (!user) {
        return <div className="text-sm text-ink-muted px-1 py-1">Sign in to see your history.</div>;
    }
    if (error) {
        return <div className="text-sm text-ink-muted px-1 py-1">Could not load history.</div>;
    }
    if (sessions === null) {
        return <div className="text-sm text-ink-muted px-1 py-1">Loading…</div>;
    }
    if (sessions.length === 0) {
        return <div className="text-sm text-ink-muted px-1 py-1">No conversations yet.</div>;
    }

    return (
        <div className="space-y-0.5">
            {sessions.map((session) => (
                <HistoryRow
                    key={session.session_id}
                    session={session}
                    onOpen={() => navigate('/chat', {
                        // navKey makes re-clicking the SAME history item work
                        // even when ChatPage never remounted (still on /chat)
                        // and its local view was already cleared some other
                        // way (e.g. New Chat) -- ChatPage's load-effect keys
                        // off both fields together, so a repeat click with an
                        // unchanged remoteSessionId still re-triggers it.
                        state: { remoteSessionId: session.session_id, navKey: Date.now() },
                    })}
                    onRename={(newTitle) => handleRename(session.session_id, newTitle)}
                    onDelete={() => handleDelete(session.session_id)}
                />
            ))}
        </div>
    );
}

function SidebarContent({ collapsed, onToggleCollapse, closeButton, onNewChat, navLinks, onOpenSettings, historyRefreshKey, historyActive }) {
    return (
        // min-w-0: this div is ITSELF a flex item of the w-64/w-24 row in
        // Sidebar's return below -- the outer box's overflow-hidden only
        // fixes that outer box's own sizing, it does nothing for this one.
        // Without min-w-0 here too, this was still trying to be as wide as
        // its widest descendant (e.g. an unclipped history row), and the
        // outer box's overflow-hidden just chopped whatever fell past
        // 256px -- no ellipsis, no reflow, just a hard cut mid-row and the
        // Settings button pushed off past the visible edge entirely. Every
        // flex container below that wraps something which could refuse to
        // shrink needs this same treatment, not just the outermost one.
        <div
            className="flex flex-col h-full min-w-0"
            style={{ backgroundColor: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
        >
            <div
                className="flex items-center justify-between px-4 h-16 shrink-0 min-w-0"
                style={{ borderBottom: '1px solid var(--color-border)' }}
            >
                <Link to="/" className="flex items-center gap-2 min-w-0">
                    <BrandMark />
                    {!collapsed && <span className="font-bold text-base text-ink truncate">Swalakshya AI</span>}
                </Link>
                {closeButton || (
                    <button
                        onClick={onToggleCollapse}
                        className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-bg"
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                    </button>
                )}
            </div>

            {navLinks}

            <div className="p-3 min-w-0">
                <button onClick={onNewChat} className="btn btn-secondary w-full" style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
                    <Plus size={16} />
                    {!collapsed && <span>New Chat</span>}
                </button>
            </div>

            {!collapsed && (
                <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 min-w-0">
                    <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide px-1 mb-2">History</div>
                    <HistoryList refreshKey={historyRefreshKey} active={historyActive} />
                </div>
            )}
            {collapsed && <div className="flex-1" />}

            <div className="p-3 flex items-center gap-2 min-w-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                <UserRow collapsed={collapsed} />
                <button
                    onClick={onOpenSettings}
                    className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-bg shrink-0"
                    title="Settings"
                    aria-label="Settings"
                >
                    <Settings size={20} />
                </button>
            </div>
        </div>
    );
}

// Persistent left sidebar on desktop (chat only); an off-canvas drawer on
// mobile carrying full site navigation, available on every page regardless of
// chatMode (backdrop + Escape-to-close, sharing the same overlay behavior as
// Modal) — this is the only way to reach the nav links below the `lg`
// breakpoint, since TopBar's own link row is desktop-only.
export default function Sidebar({ chatMode, currentPage, setCurrentPage, onNewChat, mobileOpen, onCloseMobile, onOpenSettings, historyRefreshKey }) {
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
    });
    const isDesktopViewport = useIsDesktopViewport();

    // closeOnBack=false: see LogoutConfirmModal.js.
    useOverlayBehavior(mobileOpen, onCloseMobile, { closeOnBack: false });

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch {}
            return next;
        });
    };

    return (
        <>
            {/* Desktop persistent sidebar — sticky+h-screen so it stays pinned and
                full-height as the page scrolls, without switching the whole app
                to an internal-scroll-container layout (which would break the
                existing window-scroll-based chat auto-scroll behavior). Spans both
                grid rows (row-span-2) so it overlaps TopBar's row for its own
                column — a higher z-index than TopBar (z-40 vs z-30) means it
                visually sits on top of the bar rather than being pushed below it,
                so TopBar itself stays full-width regardless of sidebar state. */}
            {chatMode && (
                // min-w-0 alone wasn't enough -- it only fixes how the grid
                // TRACK sizes itself; a child that still refuses to shrink
                // can still visually overflow past this box's own edge.
                // overflow-hidden is the actual backstop: per the CSS sizing
                // spec, a box's automatic minimum size is its content's
                // min-content size ONLY when overflow is `visible` -- any
                // other overflow value (like `hidden`) makes that automatic
                // minimum 0, so w-64/w-24 below becomes a genuine hard cap
                // instead of a suggestion, and anything that doesn't fit
                // gets clipped instead of dragging the sidebar wider.
                <div className={`hidden lg:flex shrink-0 sticky top-0 h-screen z-40 col-start-1 row-start-1 row-span-2 min-w-0 overflow-hidden transition-[width] duration-200 ${collapsed ? 'w-24' : 'w-64'}`}>
                    <SidebarContent
                        collapsed={collapsed}
                        onToggleCollapse={toggleCollapsed}
                        onNewChat={onNewChat}
                        onOpenSettings={onOpenSettings}
                        historyRefreshKey={historyRefreshKey}
                        historyActive={isDesktopViewport}
                    />
                </div>
            )}

            {/* Mobile off-canvas drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex lg:hidden">
                    <div
                        className="absolute inset-0"
                        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                        onClick={onCloseMobile}
                    />
                    <div className="relative w-64 h-full min-w-0 shrink-0 overflow-hidden">
                        <SidebarContent
                            collapsed={false}
                            onNewChat={() => { onNewChat(); onCloseMobile(); }}
                            onOpenSettings={onOpenSettings}
                            historyRefreshKey={historyRefreshKey}
                            closeButton={(
                                <button onClick={onCloseMobile} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-bg">
                                    <X size={18} />
                                </button>
                            )}
                            navLinks={(
                                <MobileNavLinks
                                    currentPage={currentPage}
                                    setCurrentPage={setCurrentPage}
                                    onNavigate={onCloseMobile}
                                />
                            )}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
