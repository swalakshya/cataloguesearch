import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MenuIcon, CloseIcon } from './SharedComponents';

// --- NAVIGATION & HEADER COMPONENTS ---
export const Navigation = ({ currentPage, setCurrentPage }) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const location = useLocation();
    
    const menuItems = [
        { id: 'home', label: 'Home', showSearch: true, path: '/' },
        { id: 'about', label: 'About', showSearch: false, path: '/about' },
        { id: 'search-index', label: 'Content', showSearch: false, path: '/search-index' },
        { id: 'usage-guide', label: 'Usage Guide', showSearch: false, path: '/usage-guide' },
        { id: 'whats-new', label: 'What\'s New?', showSearch: false, path: '/whats-new' },
        { id: 'feedback', label: 'Feedback', showSearch: false, path: '/feedback' }
    ];
    
    const handleMenuClick = (itemId) => {
        setCurrentPage(itemId);
        setIsMobileMenuOpen(false);
    };
    
    const isActive = (item) => {
        if (item.id === 'home') {
            return location.pathname === '/' && currentPage === item.id;
        }
        return location.pathname === item.path;
    };
    
    return (
        <nav className="bg-white/95 backdrop-blur-sm shadow-sm border-b border-slate-200 sticky top-0 z-40 overflow-visible">
            <div className="max-w-[1080px] mx-auto px-4 overflow-visible">
                <div className="flex items-center justify-between h-16 overflow-visible">
                    {/* Logo - pops out below navbar */}
                    <div className="flex-shrink-0 overflow-visible translate-y-2">
                        <Link to="/" onClick={() => handleMenuClick('home')}>
                            <div className="bg-white shadow-md rounded-2xl border border-slate-100 px-3 py-2 hover:shadow-lg transition-shadow duration-200">
                                <img
                                    src="/images/swalakshya_wide.png"
                                    alt="Swalakshya Logo"
                                    className="h-[3.5rem] w-auto"
                                    onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/40x40/f1f5f9/475569?text=S' }}
                                />
                            </div>
                        </Link>
                    </div>

                    {/* Desktop Menu */}
                    <div className="hidden md:flex space-x-1">
                        {menuItems.map((item) => (
                            <Link
                                key={item.id}
                                to={item.path}
                                onClick={() => handleMenuClick(item.id)}
                                className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 ${
                                    isActive(item)
                                        ? 'text-sky-700 bg-sky-50 font-semibold'
                                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="md:hidden">
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200"
                        >
                            {isMobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                {isMobileMenuOpen && (
                    <div className="md:hidden border-t border-slate-200 bg-white">
                        <div className="px-2 pt-2 pb-3 space-y-1">
                            {menuItems.map((item) => (
                                <Link
                                    key={item.id}
                                    to={item.path}
                                    onClick={() => handleMenuClick(item.id)}
                                    className={`block w-full text-left px-3 py-2 text-base font-medium rounded-md transition-colors duration-200 ${
                                        isActive(item)
                                            ? 'text-sky-600 bg-sky-50'
                                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                    }`}
                                >
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
};

export const Header = ({ currentPage }) => {

    if (currentPage === 'feedback') {
        return (
            <div className="text-center py-6 mb-4">
                <div className="bg-slate-100 h-32 md:h-40 flex items-center justify-center mb-4 overflow-hidden">
                    <img
                        src="/images/banner.jpg"
                        alt="Swa-Lakshya Banner"
                        className="h-full object-contain"
                        onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/1080x160/f1f5f9/475569?text=Aagam+Khoj' }}
                    />
                </div>
                <div className="h-32 md:h-40 flex flex-col items-center justify-center">
                    <h1 className="text-4xl font-bold text-slate-800 mb-4">Feedback</h1>
                    <div className="max-w-lg mx-auto text-slate-600 space-y-4">
                        <p>Please provide your feedback and suggestions for improving Aagam-Khoj using the form below.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (currentPage === 'whats-new') {
        return (
            <div className="text-center py-6 mb-4">
                <div className="bg-slate-100 h-32 md:h-40 flex items-center justify-center mb-4 overflow-hidden">
                    <img
                        src="/images/banner.jpg"
                        alt="Swa-Lakshya Banner"
                        className="h-full object-contain"
                        onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/1080x160/f1f5f9/475569?text=Aagam+Khoj' }}
                    />
                </div>
            </div>
        );
    }

    if (currentPage === 'usage-guide') {
        return (
            <div className="text-center py-6 mb-4">
                <div className="bg-slate-100 h-32 md:h-40 flex items-center justify-center mb-4 overflow-hidden">
                    <img
                        src="/images/banner.jpg"
                        alt="Swa-Lakshya Banner"
                        className="h-full object-contain"
                        onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/1080x160/f1f5f9/475569?text=Aagam+Khoj' }}
                    />
                </div>
            </div>
        );
    }

    if (currentPage === 'about') {
        return (
            <div className="text-center py-6 mb-4">
                <div className="bg-slate-100 h-32 md:h-40 flex items-center justify-center mb-4 overflow-hidden">
                    <img
                        src="/images/banner.jpg"
                        alt="Swa-Lakshya Banner"
                        className="h-full object-contain"
                        onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/1080x160/f1f5f9/475569?text=Aagam+Khoj' }}
                    />
                </div>
            </div>
        );
    }

    if (currentPage === 'search-index') {
        return (
            <div className="text-center py-6 mb-4">
                <div className="bg-slate-100 h-32 md:h-40 flex items-center justify-center mb-4 overflow-hidden">
                    <img
                        src="/images/banner.jpg"
                        alt="Swa-Lakshya Banner"
                        className="h-full object-contain"
                        onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/1080x160/f1f5f9/475569?text=Aagam+Khoj' }}
                    />
                </div>
                <div className="h-32 md:h-40 flex flex-col items-center justify-center">
                    <h1 className="text-4xl font-bold text-slate-800 mb-4">Searchable Content Index</h1>
                    <div className="max-w-lg mx-auto text-slate-600 space-y-4">
                        <p>Browse all available pravachans and spiritual content that you can search through.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (currentPage === 'eval') {
        return null; // No header/banner for UI Eval page
    }

    // For 'home' and 'aagam-khoj' pages
    return (
        <div className="text-center pt-6 pb-2 mb-2">
            <div>
                <div className="bg-slate-100 h-32 md:h-40 flex items-center justify-center mb-0 overflow-hidden rounded-lg mx-auto max-w-[1080px]">
                    <img
                        src="/images/banner.jpg"
                        alt="Swa-Lakshya Banner"
                        className="h-full object-contain"
                        onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/1080x160/f1f5f9/475569?text=Aagam+Khoj' }}
                    />
                </div>
                <div className="py-4 flex flex-col items-center justify-center">
                    <h1 className="text-3xl font-bold text-slate-800 font-display tracking-tight">Aagam-Khoj <span className="text-slate-500 font-normal">(आगम-खोज)</span></h1>
                    <p className="text-sm text-slate-400 mt-1 font-sans">Explore Jain Shastras/Books and Pravachans of Pujya Gurudev Shri Kanji Swami</p>
                </div>
            </div>
        </div>
    );
};
