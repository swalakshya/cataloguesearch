import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Plus, Settings, User, X } from 'lucide-react';
import { useOverlayBehavior } from '../ui/Modal';
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

function SidebarContent({ collapsed, onToggleCollapse, closeButton, onNewChat, navLinks, onOpenSettings }) {
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
                // History has no backend support yet — this stub shows the intended
                // shape (a list of past sessions) so it's a one-line swap once
                // multi-thread session storage exists server-side.
                <div className="flex-1 overflow-y-auto px-3">
                    <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide px-1 mb-2">History</div>
                    <div className="text-sm text-ink-muted px-1 py-1">Coming soon!</div>
                </div>
            )}
            {collapsed && <div className="flex-1" />}

            <div className="p-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--color-bg)' }}
                >
                    <User size={16} className="text-ink-muted" />
                </div>
                {!collapsed && <span className="text-sm text-ink flex-1 truncate">Guest</span>}
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
export default function Sidebar({ chatMode, currentPage, setCurrentPage, onNewChat, mobileOpen, onCloseMobile, onOpenSettings }) {
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
