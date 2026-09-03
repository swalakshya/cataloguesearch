import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Menu, Moon, Sun, User } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext';
import { NAV_ITEMS, NAV_DROPDOWN_LABEL, NAV_DROPDOWN_ITEMS, NAV_TAIL_ITEMS } from './navItems';

const linkClass = 'px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap';
const activeStyle = { color: 'var(--color-brand)', backgroundColor: 'color-mix(in srgb, var(--color-brand) 12%, var(--color-surface))', fontWeight: 600 };
const inactiveStyle = { color: 'var(--color-ink-muted)' };

function NavLink({ item, isActive, onNavigate }) {
    return (
        <Link
            to={item.path}
            onClick={() => onNavigate(item.id)}
            className={linkClass}
            style={isActive ? activeStyle : inactiveStyle}
        >
            {item.label}
        </Link>
    );
}

// Hover-to-open on desktop (mouse has hover); click also toggles it, so it
// still works for keyboard/touch users who reach it via focus or a tap.
function NavigateDropdown({ isActive, onNavigate }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div
            ref={ref}
            className="relative"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className={`${linkClass} inline-flex items-center gap-1`}
                style={isActive ? activeStyle : inactiveStyle}
            >
                {NAV_DROPDOWN_LABEL}
                <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div
                    className="absolute left-0 top-full pt-1 w-48 z-40"
                >
                    <div
                        className="rounded-md shadow-lg py-1"
                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                    >
                        {NAV_DROPDOWN_ITEMS.map((item) => (
                            <Link
                                key={item.id}
                                to={item.path}
                                onClick={() => { onNavigate(item.id); setOpen(false); }}
                                className="block px-3 py-2 text-sm hover:bg-bg"
                                style={{ color: 'var(--color-ink)' }}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function TopBar({ currentPage, setCurrentPage, onOpenMobileSidebar }) {
    const location = useLocation();
    const { mode, toggleMode } = useTheme();

    const isActive = (item) => {
        if (item.id === 'home') return location.pathname === '/' && currentPage === item.id;
        return location.pathname === item.path;
    };
    const isDropdownActive = NAV_DROPDOWN_ITEMS.some((item) => location.pathname === item.path);

    return (
        <>
            {/* Decorative background/border strip only — spans both grid columns so
                the bar always LOOKS full-width no matter Sidebar's state, sitting
                behind it (lower z-index) exactly like before. Carries no content:
                the real nav content below is confined to column 2 (the space
                actually free next to Sidebar) instead of centering across the
                full viewport, which could previously drift left under Sidebar's
                higher z-index panel on narrower screens and get visually covered
                by it. Column 1 auto-sizes to Sidebar's real current width (or 0
                when Sidebar is absent/hidden on mobile), so this needs no pixel
                math and no knowledge of collapsed/expanded state. */}
            <div
                aria-hidden="true"
                className="sticky top-0 z-20 col-start-1 col-span-2 row-start-1 h-16"
                style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
            />

            <header className="sticky top-0 z-30 col-start-2 row-start-1">
            {/* Fluid (no Tailwind `container` — that snaps to fixed breakpoint
                widths, which centered oddly within this narrower-than-viewport
                column) + the same max-w-[1080px] mx-auto as the page content
                below, so this whole row lines up with it at every viewport
                width. The logo is a real flex item here (not absolutely
                positioned) so it reserves its own space and can never overlap
                the nav links next to it. */}
            <div className="px-4 md:px-5">
                <div className="max-w-[1080px] mx-auto h-16 flex items-center gap-4">
                    {onOpenMobileSidebar && (
                        <button
                            onClick={onOpenMobileSidebar}
                            className="lg:hidden p-2 -ml-2 rounded-md text-ink-muted hover:text-ink hover:bg-bg shrink-0"
                            title="Open menu"
                        >
                            <Menu size={20} />
                        </button>
                    )}

                    <div className="hidden lg:block h-10 w-10 shrink-0 overflow-hidden rounded-full">
                        <img
                            src="/images/swalakshya_wide.png"
                            alt="Swalakshya"
                            className="h-full w-full object-cover"
                            style={{ objectPosition: 'left center' }}
                        />
                    </div>

                    <nav className="hidden lg:flex items-center gap-1">
                        {NAV_ITEMS.map((item) => (
                            <NavLink key={item.id} item={item} isActive={isActive(item)} onNavigate={setCurrentPage} />
                        ))}
                        <NavigateDropdown isActive={isDropdownActive} onNavigate={setCurrentPage} />
                        {NAV_TAIL_ITEMS.map((item) => (
                            <NavLink key={item.id} item={item} isActive={isActive(item)} onNavigate={setCurrentPage} />
                        ))}
                    </nav>

                    <div className="flex items-center gap-3 ml-auto shrink-0">
                        <button
                            onClick={toggleMode}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink"
                            style={{ backgroundColor: 'var(--color-bg)' }}
                            title="Toggle light/dark"
                        >
                            {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                        </button>
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: 'var(--color-bg)' }}
                            title="Account (coming soon)"
                        >
                            <User size={16} className="text-ink-muted" />
                        </div>
                    </div>
                </div>
            </div>
            </header>
        </>
    );
}
