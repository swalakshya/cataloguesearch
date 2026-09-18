import React from 'react';
import { LogOut } from 'lucide-react';
import { Modal } from '../ui';

// Mirrors SignUpPromptModal's shape AND its brand-colored icon circle --
// logout is a page-wide action, so it gets the same centered modal every
// other confirmation-worthy action in this app uses, rather than the small
// inline check/cancel swap used for a contained action like deleting a
// single history row (see useInlineConfirm). Styled with the brand token,
// not the danger one: unlike a delete, signing out isn't destructive -- you
// just sign back in -- so red would overstate it.
export default function LogoutConfirmModal({ onConfirm, onClose }) {
    return (
        // closeOnBack=false: confirmed necessary by direct testing -- the
        // Modal.js state-merge fix (see useOverlayBehavior) was theorized to
        // make this safe with the default closeOnBack=true, but that wasn't
        // actually verified against this exact symptom (open, then close
        // itself almost immediately) before being relied on, and it recurred
        // once this opt-out was removed. Keeping this explicit opt-out as
        // the primary fix; the state-merge fix stays in place too as
        // defense-in-depth for any caller that doesn't set this.
        <Modal open onClose={onClose} size="sm" closeOnBack={false}>
            <div className="text-center">
                <div
                    className="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-brand) 14%, var(--color-surface))' }}
                >
                    <LogOut size={22} style={{ color: 'var(--color-brand)' }} />
                </div>
                <h2 className="text-2xl font-bold text-ink mb-2">Sign out of Swalakshya AI?</h2>
                <p className="text-ink-muted text-base leading-relaxed mb-6">
                    You can sign back in any time to pick up your chat history where you left off.
                </p>
                <div className="flex flex-col items-center gap-3">
                    <button
                        onClick={() => { onConfirm(); onClose(); }}
                        className="btn btn-primary w-full"
                    >
                        Sign out
                    </button>
                    <button onClick={onClose} className="btn btn-ghost w-full">
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
}
