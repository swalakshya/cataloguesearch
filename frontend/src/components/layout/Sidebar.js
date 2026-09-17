import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings, User, X } from 'lucide-react';
import { useOverlayBehavior } from '../ui/Modal';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../services/api';
import AnonLoginAvatar from '../auth/AnonLoginAvatar';
import LoggedInAccountRow from '../auth/LoggedInAccountRow';
import { ALL_NAV_ITEMS } from './navItems';
import swalakshyaMark from '../../assets/swalakshya-mark.png';

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

// One history row — truncated to a single line (min-w-0 is what actually
// makes `truncate` take effect on a flex child; without it the title just
// keeps growing and spills out past the sidebar's edge instead of eliding).
// Hovering shows the full title in the app's existing tooltip-bubble style
// (see components.css, already used the same way elsewhere for hint text)
// rather than the slow/plain native browser tooltip.
function HistoryRow({ session, onOpen }) {
    const [showTooltip, setShowTooltip] = useState(false);
    const title = session.title || 'New conversation';

    return (
        <div className="relative">
            <button
                onClick={onOpen}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                onFocus={() => setShowTooltip(true)}
                onBlur={() => setShowTooltip(false)}
                className="w-full flex items-center gap-2 px-1 py-1.5 rounded-md text-left hover:bg-bg"
            >
                <MessageSquare size={14} className="text-ink-muted shrink-0" />
                <span className="text-sm text-ink flex-1 min-w-0 truncate">{title}</span>
            </button>
            {showTooltip && (
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
function HistoryList({ refreshKey }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!user) {
            setSessions(null);
            return;
        }
        let cancelled = false;
        setError(false); // clear a previous failure before each attempt, including retries
        api.listChatSessions(user.id)
            .then(({ sessions: list }) => { if (!cancelled) setSessions(list); })
            .catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [user, refreshKey]);

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
                />
            ))}
        </div>
    );
}

function SidebarContent({ collapsed, onToggleCollapse, closeButton, onNewChat, navLinks, onOpenSettings, historyRefreshKey }) {
    return (
        <div
            className="flex flex-col h-full"
            style={{ backgroundColor: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
        >
            <div
                className="flex items-center justify-between px-4 h-16 shrink-0"
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

            <div className="p-3">
                <button onClick={onNewChat} className="btn btn-secondary w-full" style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
                    <Plus size={16} />
                    {!collapsed && <span>New Chat</span>}
                </button>
            </div>

            {!collapsed && (
                <div className="flex-1 overflow-y-auto px-3">
                    <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide px-1 mb-2">History</div>
                    <HistoryList refreshKey={historyRefreshKey} />
                </div>
            )}
            {collapsed && <div className="flex-1" />}

            <div className="p-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
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

    useOverlayBehavior(mobileOpen, onCloseMobile);

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
                <div className={`hidden lg:flex shrink-0 sticky top-0 h-screen z-40 col-start-1 row-start-1 row-span-2 transition-[width] duration-200 ${collapsed ? 'w-24' : 'w-64'}`}>
                    <SidebarContent
                        collapsed={collapsed}
                        onToggleCollapse={toggleCollapsed}
                        onNewChat={onNewChat}
                        onOpenSettings={onOpenSettings}
                        historyRefreshKey={historyRefreshKey}
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
                    <div className="relative w-64 h-full">
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
