import React, { useState, useEffect, useRef } from 'react';
import { GoogleReCaptchaProvider, useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { ThumbsUp, Leaf } from 'lucide-react';
import { Spinner } from './SharedComponents';
import { Modal, Input, Textarea, Button, Card } from './ui';
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

function hasCompleteContact(contact) {
    return Boolean(
        contact &&
        String(contact.name || '').trim() &&
        String(contact.email || '').trim() &&
        String(contact.phone || '').trim()
    );
}

// A field that is either a plain input (first time / editing) or a read-only
// label that turns into an input when clicked.
function ContactField({ label, value, isEditing, onEdit, onChange, type = 'text', required, error, placeholder }) {
    if (isEditing) {
        return (
            <div>
                <label className="block text-sm font-semibold text-ink mb-1">
                    {label}{required && <span className="ml-0.5" style={{ color: 'var(--color-danger)' }}>*</span>}
                </label>
                <Input
                    type={type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    error={Boolean(error)}
                    className="text-sm"
                />
                {error && <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            </div>
        );
    }
    return (
        <div>
            <label className="block text-sm font-semibold text-ink mb-1">
                {label}{required && <span className="ml-0.5" style={{ color: 'var(--color-danger)' }}>*</span>}
            </label>
            <button
                type="button"
                onClick={onEdit}
                className="suggestion-row w-full text-left p-2.5 rounded-md text-sm transition-colors group"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
            >
                {value
                    ? <span className="text-ink">{value}</span>
                    : <span className="text-ink-muted italic">{placeholder || 'Click to add'}</span>
                }
                <span className="ml-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-brand)' }}>edit</span>
            </button>
            {error && <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        </div>
    );
}

function ReadOnlyBlock({ label, children }) {
    return (
        <Card className="p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-muted mb-1">{label}</p>
            <div className="text-sm text-ink leading-relaxed">{children}</div>
        </Card>
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

    // Escape/backdrop-close is suppressed while the success state's auto-close
    // timer is running (Modal's overlay wires both to this single handler).
    const guardedClose = () => { if (!succeeded) onClose(); };

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
                saveVote(requestId, vote);
                setSucceeded(true);
                closeTimerRef.current = setTimeout(() => onSubmit(vote), 1200);
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

    if (succeeded) {
        return (
            <Modal open onClose={guardedClose} size="sm">
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    {vote === 'helpful'
                        ? <ThumbsUp size={40} className="mb-4" style={{ color: 'var(--color-success)' }} />
                        : <Leaf size={40} className="mb-4" style={{ color: 'var(--color-success)' }} />}
                    <h2 className="text-lg font-bold text-ink mb-1">Feedback submitted</h2>
                    <p className="text-sm text-ink-muted">Thank you! This window will close shortly.</p>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            open
            onClose={guardedClose}
            title={title}
            size="md"
            footer={(
                <>
                    {submitError && (
                        <div className="badge badge-danger mb-3" style={{ display: 'block', padding: '0.5rem 0.75rem' }}>
                            {submitError}
                        </div>
                    )}
                    <Button type="submit" form="feedback-modal-form" variant="primary" disabled={isSubmitting} className="w-full justify-center">
                        {isSubmitting ? (<><Spinner /><span className="ml-2">Submitting…</span></>) : 'Submit'}
                    </Button>
                </>
            )}
        >
            <p className="text-sm text-ink-muted -mt-2 mb-4">{subtitle}</p>
            <form id="feedback-modal-form" onSubmit={handleSubmit} className="space-y-4">
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
                        <p className="text-xs text-ink-muted -mt-1">At least one of email or phone is required.</p>
                    )}
                </div>

                {/* Message — only for not_helpful */}
                {isNotHelpful && (
                    <div>
                        <label className="block text-sm font-semibold text-ink mb-1">
                            Your message<span className="ml-0.5" style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <Textarea
                            rows={4}
                            value={message}
                            onChange={e => { setMessage(e.target.value); if (errors.message) setErrors(p => ({ ...p, message: '' })); }}
                            placeholder="What was missing or incorrect? How could the answer be improved?"
                            error={Boolean(errors.message)}
                            className="text-sm resize-vertical"
                        />
                        {errors.message && <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{errors.message}</p>}
                    </div>
                )}
            </form>
        </Modal>
    );
}

function FeedbackModal(props) {
    return (
        <GoogleReCaptchaProvider reCaptchaKey={RECAPTCHA_KEY}>
            <FeedbackModalForm {...props} />
        </GoogleReCaptchaProvider>
    );
}

function HelpfulSubmitter({ requestId, question, answer, references, onSubmitted, onFallbackToModal }) {
    const { executeRecaptcha } = useGoogleReCaptcha();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);

    const handleHelpfulVote = async () => {
        const savedContact = loadContact();
        if (!hasCompleteContact(savedContact)) {
            onFallbackToModal();
            return;
        }

        if (!executeRecaptcha) {
            setSubmitError('reCAPTCHA not ready. Please try again.');
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const captchaToken = await executeRecaptcha('submit_answer_feedback');
            await api.submitAnswerFeedback({
                vote: 'helpful',
                request_id: requestId || undefined,
                question,
                answer,
                references: references || [],
                captcha_token: captchaToken,
                user_name: savedContact.name.trim(),
                user_email: savedContact.email.trim(),
                user_phone: savedContact.phone.trim(),
            });
            saveVote(requestId, 'helpful');
            onSubmitted('helpful');
        } catch (err) {
            if (err.detail === 'feedback_already_submitted') {
                saveVote(requestId, 'helpful');
                onSubmitted('helpful');
            } else if (err.detail === 'feedback_not_enabled') {
                setSubmitError('Feedback is not enabled on this server.');
            } else {
                setSubmitError('Failed to submit feedback. Please try again.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <button
                onClick={handleHelpfulVote}
                disabled={isSubmitting}
                aria-label="Mark as helpful"
                className="btn btn-secondary inline-flex items-center gap-1.5 text-xs py-1 px-2"
            >
                {isSubmitting ? <Spinner /> : <ThumbsUp size={14} />}
                <span>Helpful</span>
            </button>
            {submitError && (
                <span className="text-sm" style={{ color: 'var(--color-danger)' }}>{submitError}</span>
            )}
        </>
    );
}

export function FeedbackButtons({ requestId, question, answer, references, citations, followUpQuestions }) {
    const [submitted, setSubmitted] = useState(() => loadVote(requestId));
    const [modalVote, setModalVote] = useState(null);   // null | 'helpful' | 'not_helpful'

    useEffect(() => {
        setSubmitted(loadVote(requestId));
    }, [requestId]);

    const handleVote = (vote) => {
        if (submitted) return;
        setModalVote(vote);
    };

    return (
        <>
            <div className="flex items-center gap-2">
                {submitted ? (
                    <button
                        disabled
                        aria-label="Mark as helpful"
                        className={`btn inline-flex items-center gap-1.5 text-xs py-1 px-2 ${submitted === 'helpful' ? 'badge-success' : 'btn-secondary'}`}
                        style={submitted !== 'helpful' ? { opacity: 0.4 } : undefined}
                    >
                        <ThumbsUp size={14} /><span>Helpful</span>
                    </button>
                ) : (
                    <GoogleReCaptchaProvider reCaptchaKey={RECAPTCHA_KEY}>
                        <HelpfulSubmitter
                            requestId={requestId}
                            question={question}
                            answer={answer}
                            references={references}
                            onSubmitted={(vote) => setSubmitted(vote)}
                            onFallbackToModal={() => setModalVote('helpful')}
                        />
                    </GoogleReCaptchaProvider>
                )}
                <button
                    onClick={() => handleVote('not_helpful')}
                    disabled={!!submitted}
                    aria-label="Mark as not helpful"
                    className={`btn inline-flex items-center gap-1.5 text-xs py-1 px-2 ${submitted === 'not_helpful' ? 'badge-danger' : 'btn-secondary'}`}
                    style={submitted && submitted !== 'not_helpful' ? { opacity: 0.4 } : undefined}
                >
                    <Leaf size={14} /><span>Not helpful</span>
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
