import React, { useState } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { CheckCircle2 } from 'lucide-react';
import { Spinner } from './SharedComponents';
import { api } from '../services/api';
import { PageHeader, Card, Input, Textarea, Button } from './ui';

// --- FEEDBACK COMPONENTS ---
export const FeedbackForm = ({ onReturnToAagamKhoj }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phoneNumber: '',
        subject: '',
        feedback: ''
    });
    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const { executeRecaptcha } = useGoogleReCaptcha();

    const validateForm = () => {
        const newErrors = {};

        if (!formData.name.trim()) {
            newErrors.name = 'Name is required';
        }

        if (!formData.subject.trim()) {
            newErrors.subject = 'Subject is required';
        }

        if (!formData.feedback.trim()) {
            newErrors.feedback = 'Feedback is required';
        }

        if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = 'Please enter a valid email address';
        }

        return newErrors;
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const formErrors = validateForm();
        if (Object.keys(formErrors).length > 0) {
            setErrors(formErrors);
            return;
        }

        if (!executeRecaptcha) {
            setErrors({ submit: 'reCAPTCHA not ready. Please try again.' });
            return;
        }

        setIsSubmitting(true);
        try {
            // Execute reCAPTCHA v3 and get token
            const captchaToken = await executeRecaptcha('submit_feedback');

            // Submit feedback with the token
            await api.submitFeedback({
                ...formData,
                captchaToken
            });

            setSubmitSuccess(true);
            setFormData({
                name: '',
                email: '',
                phoneNumber: '',
                subject: '',
                feedback: ''
            });
        } catch (error) {
            setErrors({ submit: 'Failed to submit feedback. Please try again.' });
        }
        setIsSubmitting(false);
    };

    if (submitSuccess) {
        return (
            <div className="max-w-2xl mx-auto">
                <Card className="notice-success p-6 text-center">
                    <div className="mb-4" style={{ color: 'var(--color-success)' }}>
                        <CheckCircle2 size={56} className="mx-auto" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-success)' }}>Thank you for your feedback!</h3>
                    <p className="text-ink mb-4">Your message has been successfully submitted. We appreciate your input and will review it carefully.</p>
                    <Button onClick={() => onReturnToAagamKhoj()}>
                        Return to Swalakshya Chat
                    </Button>
                </Card>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            <PageHeader
                variant="hero"
                title="Feedback"
                subtitle="Share your thoughts, suggestions, or report an issue — we read every message."
            />
            <form onSubmit={handleSubmit} className="card p-6 md:p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="name" className="block text-sm font-semibold text-ink mb-2">
                            Name <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <Input
                            type="text"
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleInputChange('name', e.target.value)}
                            error={!!errors.name}
                            placeholder="Enter your name"
                        />
                        {errors.name && <p className="text-sm mt-1" style={{ color: 'var(--color-danger)' }}>{errors.name}</p>}
                    </div>

                    <div>
                        <label htmlFor="email" className="block text-sm font-semibold text-ink mb-2">
                            Email <span className="text-ink-muted">(optional)</span>
                        </label>
                        <Input
                            type="email"
                            id="email"
                            value={formData.email}
                            onChange={(e) => handleInputChange('email', e.target.value)}
                            error={!!errors.email}
                            placeholder="Enter your email"
                        />
                        {errors.email && <p className="text-sm mt-1" style={{ color: 'var(--color-danger)' }}>{errors.email}</p>}
                    </div>
                </div>

                <div>
                    <label htmlFor="phoneNumber" className="block text-sm font-semibold text-ink mb-2">
                        Phone Number <span className="text-ink-muted">(optional)</span>
                    </label>
                    <Input
                        type="tel"
                        id="phoneNumber"
                        value={formData.phoneNumber}
                        onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                        placeholder="Enter your phone number"
                    />
                </div>

                <div>
                    <label htmlFor="subject" className="block text-sm font-semibold text-ink mb-2">
                        Subject <span style={{ color: 'var(--color-danger)' }}>*</span>
                    </label>
                    <Input
                        type="text"
                        id="subject"
                        value={formData.subject}
                        onChange={(e) => handleInputChange('subject', e.target.value)}
                        error={!!errors.subject}
                        placeholder="Enter the subject of your feedback"
                    />
                    {errors.subject && <p className="text-sm mt-1" style={{ color: 'var(--color-danger)' }}>{errors.subject}</p>}
                </div>

                <div>
                    <label htmlFor="feedback" className="block text-sm font-semibold text-ink mb-2">
                        Feedback <span style={{ color: 'var(--color-danger)' }}>*</span>
                    </label>
                    <Textarea
                        id="feedback"
                        rows="6"
                        value={formData.feedback}
                        onChange={(e) => handleInputChange('feedback', e.target.value)}
                        error={!!errors.feedback}
                        className="resize-vertical"
                        placeholder="Please share your feedback, suggestions, or report any issues..."
                    />
                    {errors.feedback && <p className="text-sm mt-1" style={{ color: 'var(--color-danger)' }}>{errors.feedback}</p>}
                </div>

                {errors.submit && (
                    <div className="notice notice-danger p-3">
                        <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{errors.submit}</p>
                    </div>
                )}

                <div className="pt-4">
                    <Button type="submit" disabled={isSubmitting} className="w-full text-base py-3">
                        {isSubmitting ? (
                            <>
                                <Spinner />
                                <span className="ml-2">Submitting...</span>
                            </>
                        ) : (
                            'Submit Feedback'
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
};