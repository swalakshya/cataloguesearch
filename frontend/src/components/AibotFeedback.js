import React, { useState, useEffect, useRef } from 'react';
import { GoogleReCaptchaProvider, useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { Spinner } from './SharedComponents';
import { api } from '../services/api';

const RECAPTCHA_KEY = process.env.REACT_APP_RECAPTCHA_SITE_KEY || '__REACT_APP_RECAPTCHA_SITE_KEY__';
const CONTACT_KEY = 'aibot_feedback_contact';
const VOTES_KEY = 'aibot_feedback_votes';

function loadContact() {
    try {
        const raw = localStorage.getItem(CONTACT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveContact(contact) {
    try { localStorage.setItem(CONTACT_KEY, JSON.stringify(contact)); } catch {}
}

function loadVote(requestId) {
    if (!requestId) return null;
    try {
        const raw = localStorage.getItem(VOTES_KEY);
        const votes = raw ? JSON.parse(raw) : {};
        return votes[requestId] || null;
    } catch { return null; }
}

function saveVote(requestId, vote) {
    if (!requestId) return;
    try {
        const raw = localStorage.getItem(VOTES_KEY);
        const votes = raw ? JSON.parse(raw) : {};
        votes[requestId] = vote;
        localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
    } catch {}
}

// A field that is either a plain input (first time / editing) or a read-only
// label that turns into an input when clicked.
function ContactField({ label, value, isEditing, onEdit, onChange, type = 'text', required, error, placeholder }) {
    if (isEditing) {
        return (
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <input
                    type={type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={`w-full p-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 text-sm ${error ? 'border-red-500' : 'border-slate-300'}`}
                />
                {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
            </div>
        );
    }
    return (
        <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
                {label}{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <button
                type="button"
                onClick={onEdit}
                className="w-full text-left p-2.5 border border-slate-200 rounded-md bg-slate-50 text-sm hover:border-sky-300 hover:bg-sky-50 transition-colors group"
            >
                {value
                    ? <span className="text-slate-800">{value}</span>
                    : <span className="text-slate-400 italic">{placeholder || 'Click to add'}</span>
                }
                <span className="ml-2 text-xs text-sky-500 opacity-0 group-hover:opacity-100 transition-opacity">edit</span>
            </button>
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>
    );
}

function ReadOnlyBlock({ label, children }) {
    return (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
            <div className="text-sm text-slate-700 leading-relaxed">{children}</div>
        </div>
    );
}

// The inner form — must be rendered inside a GoogleReCaptchaProvider.
function FeedbackModalForm({ vote, requestId, question, answer, references, followUpQuestions, onClose, onSubmit }) {
    const { executeRecaptcha } = useGoogleReCaptcha();
    const savedContact = loadContact();
    const isFirstTime = !savedContact;

    const [contact, setContact] = useState({
        name: savedContact?.name || '',
        email: savedContact?.email || '',
        phone: savedContact?.phone || '',
    });
    // On first visit all fields are editable; on repeat visits fields show as read-only
    // until the user clicks on them.
    const [editing, setEditing] = useState({
        name: isFirstTime,
        email: isFirstTime,
        phone: isFirstTime,
    });
    const [message, setMessage] = useState('');
    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [succeeded, setSucceeded] = useState(false);
    const closeTimerRef = useRef(null);

    useEffect(() => {
        return () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
    }, []);

    const setField = (field, value) => {
        setContact(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };

    const startEditing = (field) => setEditing(prev => ({ ...prev, [field]: true }));

    const validate = () => {
        const e = {};
        if (vote === 'not_helpful' && !contact.name.trim()) e.name = 'Name is required';
        if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
            e.email = 'Please enter a valid email address';
        }
        if (vote === 'not_helpful') {
            if (!contact.email.trim() && !contact.phone.trim()) {
                e.email = 'Email or phone is required';
                e.phone = 'Email or phone is required';
            }
            if (!message.trim()) e.message = 'Please describe the issue';
        }
        return e;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const errs = validate();
        if (Object.keys(errs).length > 0) { setErrors(errs); return; }

        if (!executeRecaptcha) {
            setSubmitError('reCAPTCHA not ready. Please try again.');
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const captchaToken = await executeRecaptcha('submit_answer_feedback');
            const payload = {
                vote,
                request_id: requestId || undefined,
                question,
                answer,
                references: references || [],
                captcha_token: captchaToken,
            };
            if (vote === 'not_helpful') {
                payload.user_name = contact.name.trim();
                if (contact.email.trim()) payload.user_email = contact.email.trim();
                if (contact.phone.trim()) payload.user_phone = contact.phone.trim();
                payload.message = message.trim();
            } else {
                // helpful — contact info is optional but we still send it if provided
                if (contact.name.trim()) payload.user_name = contact.name.trim();
                if (contact.email.trim()) payload.user_email = contact.email.trim();
                if (contact.phone.trim()) payload.user_phone = contact.phone.trim();
            }
            await api.submitAnswerFeedback(payload);
            saveContact({ name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() });
            saveVote(requestId, vote);
            setSucceeded(true);
            closeTimerRef.current = setTimeout(() => onSubmit(vote), 2000);
        } catch (err) {
            if (err.detail === 'feedback_already_submitted') {
                setSubmitError('Feedback already submitted for this answer.');
            } else if (err.detail === 'feedback_not_enabled') {
                setSubmitError('Feedback is not enabled on this server.');
            } else {
                setSubmitError('Failed to submit feedback. Please try again.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const isNotHelpful = vote === 'not_helpful';
    const title = isNotHelpful ? 'Help us improve' : 'Thank you for your support!';
    const subtitle = isNotHelpful
        ? 'Please share what was missing or incorrect.'
        : 'Optionally share your contact info so we can reach you.';

    return (
        // Overlay
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onClick={e => { if (e.target === e.currentTarget && !succeeded) onClose(); }}
        >
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                {succeeded && (
                    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                        <div className="text-5xl mb-4">{vote === 'helpful' ? '🙏' : '🍃'}</div>
                        <h2 className="text-lg font-bold text-slate-900 mb-1">Feedback submitted</h2>
                        <p className="text-sm text-slate-500">Thank you! This window will close shortly.</p>
                    </div>
                )}
                {!succeeded && <>
                {/* Header */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">{title}</h2>
                        <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable body */}
                <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
                    {/* Context display — only for not_helpful */}
                    {isNotHelpful && (
                        <div className="space-y-2">
                            <ReadOnlyBlock label="Question">
                                <p>{question}</p>
                            </ReadOnlyBlock>
                            <ReadOnlyBlock label="Answer">
                                <p className="whitespace-pre-wrap line-clamp-6">{answer}</p>
                            </ReadOnlyBlock>
                            {references && references.length > 0 && (
                                <ReadOnlyBlock label="References">
                                    <ul className="list-disc list-inside space-y-0.5">
                                        {references.map((ref, i) => (
                                            <li key={i} className="truncate">{ref}</li>
                                        ))}
                                    </ul>
                                </ReadOnlyBlock>
                            )}
                            {followUpQuestions && followUpQuestions.length > 0 && (
                                <ReadOnlyBlock label="Follow-up questions">
                                    <ul className="list-disc list-inside space-y-0.5">
                                        {followUpQuestions.map((q, i) => (
                                            <li key={i}>{q}</li>
                                        ))}
                                    </ul>
                                </ReadOnlyBlock>
                            )}
                        </div>
                    )}

                    {/* Contact fields */}
                    <div className="grid grid-cols-1 gap-3">
                        <ContactField
                            label="Name"
                            value={contact.name}
                            isEditing={editing.name}
                            onEdit={() => startEditing('name')}
                            onChange={v => setField('name', v)}
                            required={vote === 'not_helpful'}
                            error={errors.name}
                            placeholder="Your name"
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <ContactField
                                label="Email"
                                type="email"
                                value={contact.email}
                                isEditing={editing.email}
                                onEdit={() => startEditing('email')}
                                onChange={v => setField('email', v)}
                                required={false}
                                error={errors.email}
                                placeholder="your@email.com"
                            />
                            <ContactField
                                label="Phone"
                                type="tel"
                                value={contact.phone}
                                isEditing={editing.phone}
                                onEdit={() => startEditing('phone')}
                                onChange={v => setField('phone', v)}
                                required={false}
                                error={errors.phone}
                                placeholder="Phone number"
                            />
                        </div>
                        {isNotHelpful && vote === 'not_helpful' && !contact.email.trim() && !contact.phone.trim() && errors.email && (
                            <p className="text-xs text-slate-500 -mt-1">At least one of email or phone is required.</p>
                        )}
                    </div>

                    {/* Message — only for not_helpful */}
                    {isNotHelpful && (
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">
                                Your message<span className="text-red-500 ml-0.5">*</span>
                            </label>
                            <textarea
                                rows={4}
                                value={message}
                                onChange={e => { setMessage(e.target.value); if (errors.message) setErrors(p => ({ ...p, message: '' })); }}
                                placeholder="What was missing or incorrect? How could the answer be improved?"
                                className={`w-full p-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 text-sm resize-vertical ${errors.message ? 'border-red-500' : 'border-slate-300'}`}
                            />
                            {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message}</p>}
                        </div>
                    )}

                    {submitError && (
                        <div className="bg-red-50 border border-red-200 rounded-md p-3">
                            <p className="text-red-700 text-sm">{submitError}</p>
                        </div>
                    )}
                </form>

                {/* Footer */}
                <div className="px-5 pb-5 pt-3 border-t border-slate-100 shrink-0">
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="w-full bg-sky-600 text-white font-semibold py-2.5 px-4 rounded-md hover:bg-sky-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center text-sm"
                    >
                        {isSubmitting ? (
                            <><Spinner /><span className="ml-2">Submitting…</span></>
                        ) : (
                            'Submit'
                        )}
                    </button>
                </div>
                </>}
            </div>
        </div>
    );
}

function FeedbackModal(props) {
    return (
        <GoogleReCaptchaProvider reCaptchaKey={RECAPTCHA_KEY}>
            <FeedbackModalForm {...props} />
        </GoogleReCaptchaProvider>
    );
}

export function FeedbackButtons({ requestId, question, answer, references, citations, followUpQuestions }) {
    const [submitted, setSubmitted] = useState(() => loadVote(requestId));
    const [modalVote, setModalVote] = useState(null);   // null | 'helpful' | 'not_helpful'

    const handleVote = (vote) => {
        if (submitted) return;
        setModalVote(vote);
    };

    return (
        <>
            <div className="mt-5 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-600 mr-1">Was this helpful?</span>
                <button
                    onClick={() => handleVote('helpful')}
                    disabled={!!submitted}
                    aria-label="Mark as helpful"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-200 ${
                        submitted === 'helpful'
                            ? 'bg-green-50 border-green-300 text-green-800'
                            : submitted
                            ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-500'
                            : 'border-slate-200 text-slate-700 hover:bg-green-50 hover:border-green-200 hover:text-green-800'
                    }`}
                >
                    <span>🙏</span><span>Helpful</span>
                </button>
                <button
                    onClick={() => handleVote('not_helpful')}
                    disabled={!!submitted}
                    aria-label="Mark as not helpful"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-200 ${
                        submitted === 'not_helpful'
                            ? 'bg-red-50 border-red-300 text-red-800'
                            : submitted
                            ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-500'
                            : 'border-slate-200 text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-800'
                    }`}
                >
                    <span>🍃</span><span>Not helpful</span>
                </button>
            </div>

            {modalVote && (
                <FeedbackModal
                    vote={modalVote}
                    requestId={requestId}
                    question={question}
                    answer={answer}
                    references={references}
                    citations={citations}
                    followUpQuestions={followUpQuestions}
                    onClose={() => setModalVote(null)}
                    onSubmit={(vote) => { setSubmitted(vote); setModalVote(null); }}
                />
            )}
        </>
    );
}
