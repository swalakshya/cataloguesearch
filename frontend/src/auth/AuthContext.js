import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../services/api';
import { USER_ID } from '../utils/userId';
import { AUTH_LOGOUT_EVENT, CHAT_SESSION_STORAGE_KEY } from '../config/chatConfig';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        api.getCurrentUser()
            .then(({ user: restoredUser }) => { if (!cancelled) setUser(restoredUser); })
            .catch(() => { if (!cancelled) setUser(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const login = useCallback(async (idToken) => {
        const { user: loggedInUser } = await api.googleLogin(idToken);
        setUser(loggedInUser);
        try {
            // Best-effort: pre-login anonymous history should carry over, but a
            // failed merge shouldn't block the login itself.
            await api.mergeAnonymousSessions(USER_ID);
        } catch (err) {
            console.warn('Could not merge anonymous session history', err);
        }
        return loggedInUser;
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.logout();
        } finally {
            setUser(null);
            // Local-only reset: the just-signed-out browser shouldn't keep
            // showing the previous account's conversation, but nothing here
            // touches the server -- it stays in that account's History for
            // next time they sign in. See CHAT_SESSION_STORAGE_KEY's own note
            // for why this key lives in chatConfig.js rather than here.
            try { localStorage.removeItem(CHAT_SESSION_STORAGE_KEY); } catch {}
            window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
        }
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}

// Compact UI spots (top bar, sidebar) show a first name, not the full name —
// prefer Google's own given_name claim (handles multi-word surnames and
// non-Latin scripts correctly), falling back to splitting the full name for
// accounts created before given_name was captured.
export function getDisplayName(user) {
    if (!user) return '';
    return user.given_name || user.name?.split(' ')[0] || user.name || '';
}
