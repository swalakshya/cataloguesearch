import React from 'react';
import { LogOut } from 'lucide-react';
import { getDisplayName } from '../../auth/AuthContext';
import { Avatar } from '../layout/Sidebar';

// Shared logged-in identity row (avatar + name + sign-out), used by both
// Sidebar.js's UserRow and TopBar.js's AccountSlot -- previously duplicated
// in both places, including the confirm-dialog wording, which could easily
// have drifted between the two on a future edit.
export default function LoggedInAccountRow({ user, logout, nameClassName = '' }) {
    const handleLogout = () => {
        if (window.confirm('Are you sure you want to log out?')) logout();
    };

    return (
        <>
            <Avatar user={user} />
            <span className={`text-sm text-ink truncate ${nameClassName}`}>{getDisplayName(user)}</span>
            <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-bg shrink-0"
                title="Sign out"
                aria-label="Sign out"
            >
                <LogOut size={16} />
            </button>
        </>
    );
}
