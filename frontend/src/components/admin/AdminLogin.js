import React, { useState } from 'react';
import { api } from '../../services/api';

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const AdminLogin = ({ onAuth }) => {
    const [key, setKey] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const keyHash = await sha256(key);
            const { token } = await api.adminAuth(keyHash);
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
                    <input
                        type="password"
                        value={key}
                        onChange={e => setKey(e.target.value)}
                        placeholder="Admin key"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        autoFocus
                    />
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
