import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { getDisplayName } from '../../auth/AuthContext';
import { Avatar } from '../layout/Sidebar';
import LogoutConfirmModal from './LogoutConfirmModal';

// Shared logged-in identity row (avatar + name + sign-out), used by both
// Sidebar.js's UserRow and TopBar.js's AccountSlot -- previously duplicated
// in both places, including the confirm wording, which could easily have
// drifted between the two on a future edit.
export default function LoggedInAccountRow({ user, logout, nameClassName = '' }) {
    const [confirmOpen, setConfirmOpen] = useState(false);

    return (
        <>
            <Avatar user={user} />
            <span className={`text-sm text-ink truncate ${nameClassName}`}>{getDisplayName(user)}</span>
            <button
                onClick={() => setConfirmOpen(true)}
                className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-bg shrink-0"
                title="Sign out"
                aria-label="Sign out"
            >
                <LogOut size={16} />
            </button>
            {confirmOpen && (
                <LogoutConfirmModal onConfirm={logout} onClose={() => setConfirmOpen(false)} />
            )}
        </>
    );
}
