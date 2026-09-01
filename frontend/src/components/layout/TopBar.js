import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, User } from 'lucide-react';
import { NAV_ITEMS } from './navItems';

export default function TopBar({ currentPage, setCurrentPage, onOpenMobileSidebar }) {
    const location = useLocation();

    const isActive = (item) => {
        if (item.id === 'home') return location.pathname === '/' && currentPage === item.id;
        return location.pathname === item.path;
    };

    return (
        <header
            className="sticky top-0 z-30 shrink-0"
            style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
        >
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

                    <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
                        {NAV_ITEMS.map((item) => (
                            <Link
                                key={item.id}
                                to={item.path}
                                onClick={() => setCurrentPage(item.id)}
                                className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap"
                                style={isActive(item)
                                    ? { color: 'var(--color-brand)', backgroundColor: 'color-mix(in srgb, var(--color-brand) 12%, var(--color-surface))', fontWeight: 600 }
                                    : { color: 'var(--color-ink-muted)' }}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>

                    <div className="flex items-center gap-1 ml-auto shrink-0">
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
    );
}
