import React, { useState } from 'react';
import { api } from '../../services/api';

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const AdminLogin = ({ onAuth }) => {
    const [key, setKey] = useState(() => localStorage.getItem('adminKey') || '');
    const [showKey, setShowKey] = useState(false);
    const [saveKey, setSaveKey] = useState(() => !!localStorage.getItem('adminKey'));
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const keyHash = await sha256(key);
            const { token } = await api.adminAuth(keyHash);
            if (saveKey) localStorage.setItem('adminKey', key);
            else localStorage.removeItem('adminKey');
            onAuth(token);
        } catch {
            setError('Invalid key. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-md border border-slate-200 p-8 w-full max-w-sm">
                <h1 className="text-xl font-bold text-slate-800 mb-1">Admin</h1>
                <p className="text-sm text-slate-500 mb-6">Enter your admin key to continue.</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative">
                        <input
                            type={showKey ? 'text' : 'password'}
                            value={key}
                            onChange={e => setKey(e.target.value)}
                            placeholder="Admin key"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(v => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            tabIndex={-1}
                        >
                            {showKey ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            )}
                        </button>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={saveKey}
                            onChange={e => setSaveKey(e.target.checked)}
                            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        Remember on this device
                    </label>

                    {error && <p className="text-red-600 text-xs">{error}</p>}
                    <button
                        type="submit"
                        disabled={loading || !key}
                        className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                    >
                        {loading ? 'Verifying…' : 'Continue'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminLogin;
