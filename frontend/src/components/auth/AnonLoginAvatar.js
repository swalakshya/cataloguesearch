import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { User } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

// Total width of the invisible real Google button below, kept in sync with
// the visible icon+"Sign in" row's own rendered width so the whole row is
// clickable, not just the icon.
const ROW_WIDTH = 112;

// Mirrors the logged-in row's own layout (avatar + name) with "Sign in" in
// place of a name, but is a real (if invisible) Google Sign-In button
// underneath. Google's own icon-type button reliably fails to paint its "G"
// glyph in this app's environment (confirmed twice) -- using the
// (confirmed-working) standard button type here instead, just hidden, so
// there's no doubt the click itself still works. Shared by Sidebar.js's
// UserRow and TopBar.js's AccountSlot so both stay identical.
//
// showLabel=false drops the "Sign in" text for tight spaces (the sidebar's
// collapsed 96px rail) -- just the ring-outlined icon, still clickable.
export default function AnonLoginAvatar({ size = 32, showLabel = true }) {
    const { login } = useAuth();
    const rowWidth = showLabel ? ROW_WIDTH : size;

    return (
        <div
            className="group relative flex items-center gap-2 cursor-pointer"
            style={{ width: rowWidth }}
            title="Sign in with Google"
        >
            <div className="pointer-events-none flex items-center gap-2">
                <div
                    className="anon-login-ring rounded-full flex items-center justify-center shrink-0"
                    style={{ width: size, height: size }}
                >
                    <User size={Math.round(size * 0.5)} className="text-ink-muted" />
                </div>
                {showLabel && (
                    <span className="text-sm text-ink-muted whitespace-nowrap group-hover:text-ink transition-colors">
                        Sign in
                    </span>
                )}
            </div>

            <div className="absolute inset-0 overflow-hidden opacity-0">
                <GoogleLogin
                    onSuccess={(credentialResponse) => {
                        if (!credentialResponse.credential) return;
                        // No inline error UI fits this compact a control --
                        // at minimum, catch it so a failed login doesn't
                        // surface as an unhandled promise rejection.
                        login(credentialResponse.credential).catch((err) => {
                            console.error('Google sign-in failed', err);
                        });
                    }}
                    onError={() => console.error('Google sign-in failed')}
                    size="medium"
                    shape="rectangular"
                    text="signin"
                    width={String(rowWidth)}
                />
            </div>
        </div>
    );
}
