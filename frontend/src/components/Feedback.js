import React, { useState } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { Spinner } from './SharedComponents';
import { api } from '../services/api';

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
                <div className="bg-green-50 border border-green-200 p-6 rounded-lg text-center">
                    <div className="text-green-600 mb-4">
                        <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-green-800 mb-2">Thank you for your feedback!</h3>
                    <p className="text-green-700 mb-4">Your message has been successfully submitted. We appreciate your input and will review it carefully.</p>
                    <button
                        onClick={() => onReturnToAagamKhoj()}
                        className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition duration-200"
                    >
                        Return to Swalakshya Chat
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            <form onSubmit={handleSubmit} style={{ backgroundColor: 'var(--bg-card, white)' }} className="bg-white p-6 md:p-8 rounded-lg shadow-sm border border-slate-200 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="name" className="block text-sm font-semibold text-slate-700 mb-2">
                            Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleInputChange('name', e.target.value)}
                            className={`w-full p-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 ${
                                errors.name ? 'border-red-500' : 'border-slate-300'
                            }`}
                            placeholder="Enter your name"
                        />
                        {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                    </div>

                    <div>
                        <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                            Email <span className="text-slate-400">(optional)</span>
                        </label>
                        <input
                            type="email"
                            id="email"
                            value={formData.email}
                            onChange={(e) => handleInputChange('email', e.target.value)}
                            className={`w-full p-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 ${
                                errors.email ? 'border-red-500' : 'border-slate-300'
                            }`}
                            placeholder="Enter your email"
                        />
                        {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
                    </div>
                </div>

                <div>
                    <label htmlFor="phoneNumber" className="block text-sm font-semibold text-slate-700 mb-2">
                        Phone Number <span className="text-slate-400">(optional)</span>
                    </label>
                    <input
                        type="tel"
                        id="phoneNumber"
                        value={formData.phoneNumber}
                        onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                        className="w-full p-3 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900"
                        placeholder="Enter your phone number"
                    />
                </div>

                <div>
                    <label htmlFor="subject" className="block text-sm font-semibold text-slate-700 mb-2">
                        Subject <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        id="subject"
                        value={formData.subject}
                        onChange={(e) => handleInputChange('subject', e.target.value)}
                        className={`w-full p-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 ${
                            errors.subject ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="Enter the subject of your feedback"
                    />
                    {errors.subject && <p className="text-red-500 text-sm mt-1">{errors.subject}</p>}
                </div>

                <div>
                    <label htmlFor="feedback" className="block text-sm font-semibold text-slate-700 mb-2">
                        Feedback <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        id="feedback"
                        rows="6"
                        value={formData.feedback}
                        onChange={(e) => handleInputChange('feedback', e.target.value)}
                        className={`w-full p-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 resize-vertical ${
                            errors.feedback ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="Please share your feedback, suggestions, or report any issues..."
                    />
                    {errors.feedback && <p className="text-red-500 text-sm mt-1">{errors.feedback}</p>}
                </div>

                {errors.submit && (
                    <div className="bg-red-50 border border-red-200 p-3 rounded-md">
                        <p className="text-red-700 text-sm">{errors.submit}</p>
                    </div>
                )}

                <div className="pt-4">
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-sky-600 text-white font-semibold py-3 px-6 rounded-md hover:bg-sky-700 transition duration-200 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center text-base"
                    >
                        {isSubmitting ? (
                            <>
                                <Spinner />
                                <span className="ml-2">Submitting...</span>
                            </>
                        ) : (
                            'Submit Feedback'
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};