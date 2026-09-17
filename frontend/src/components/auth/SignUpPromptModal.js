import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Modal } from '../ui';
import { useAuth } from '../../auth/AuthContext';

// Mirrors Modals.js's WelcomeModal (icon + heading + primary action + a
// "skip" fallback), but the primary action is the real Google Sign-In button
// itself rather than a plain CTA that navigates somewhere.
export default function SignUpPromptModal({ onClose }) {
    const { login } = useAuth();
    const [error, setError] = useState(null);

    const handleSuccess = async (credentialResponse) => {
        if (!credentialResponse.credential) {
            setError('Google did not return a credential. Please try again.');
            return;
        }
        setError(null);
        try {
            await login(credentialResponse.credential);
            onClose();
        } catch {
            // Keep the modal open on failure -- closing it here would make
            // sign-up look like it silently vanished with no explanation.
            setError('Sign-in failed. Please try again.');
        }
    };

    return (
        <Modal open onClose={onClose} size="sm">
            <div className="text-center">
                <div
                    className="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-brand) 14%, var(--color-surface))' }}
                >
                    <span className="text-2xl">💬</span>
                </div>
                <h2 className="text-2xl font-bold text-ink mb-2">Sign up on Swalakshya</h2>
                <p className="text-ink-muted text-base leading-relaxed mb-6">
                    Signing up helps you access your chat history any time you come back.
                </p>
                <div className="flex flex-col items-center gap-3">
                    <GoogleLogin
                        onSuccess={handleSuccess}
                        onError={() => setError('Google sign-in failed. Please try again.')}
                        size="large"
                        shape="pill"
                        text="signup_with"
                        width="280"
                    />
                    {error && (
                        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>
                    )}
                    <button onClick={onClose} className="btn btn-ghost w-full">
                        No thanks, continue without signing up
                    </button>
                </div>
            </div>
        </Modal>
    );
}
