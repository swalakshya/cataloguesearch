import React, { useEffect } from 'react';
import TypingGuide from './TypingGuide';

const UsageGuide = () => {
    const guideSection = [
        {
            title: "Getting Started",
            icon: (
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            ),
            content: [
                "Enter your search query in the search box at the top of the page",
                "Click the 'Search' button or press Enter to search",
                "Browse through keyword and semantic search results using the tabs",
                "Use filters to narrow down your search results by categories"
            ]
        },
        {
            title: "Writing Effective Queries",
            icon: (
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
            ),
            content: [
                "Write in Hindi for the most accurate results",
                "For questions or specific phrases, end with punctuation like a question mark (?) or a Purn Viram (।)",
                "If writing in English, avoid mixing in Hindi words written in the English alphabet (Hinglish)",
                "Use specific terms and concepts from the pravachans for better results"
            ]
        },
        {
            title: "Search Features",
            icon: (
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            ),
            content: [
                "Keyword Search: Fast search that matches your exact terms",
                "Semantic Search: AI-powered search that understands context and meaning",
                "Similar Documents: Find related content to any search result",
                "Advanced Filters: Filter by categories, language, and more"
            ]
        },
        {
            title: "Advanced Options",
            icon: (
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            ),
            content: [
                "Exact Match: Search for exact phrases by enabling this option",
                "Exclude Words: Exclude specific words from your search results",
                "Language Selection: Choose between Hindi and English search modes",
                "Search Type: Choose between fast (speed) or accurate (relevance) search"
            ]
        }
    ];

    const examples = [
        {
            category: "Good Examples",
            type: "success",
            items: [
                "कुन्दकुन्दाचार्य विदेह",
                "शुद्धभाव अधिकार",
                "सम्यक् एकांत",
                "दृष्टि का विषय क्या है?",
                "कुन्दकुन्दाचार्य विदेह क्षेत्र कब गए थे?",
                "Where does Seemandhar God reside?"
            ]
        },
        {
            category: "Avoid These",
            type: "warning",
            items: [
                "सम्यक् एकांत क्या है",
                "Kundkund Acharya kaun hai?",
                "jivatma kya hai"
            ]
        }
    ];

    // Handle hash scrolling when component loads
    useEffect(() => {
        const hash = window.location.hash;
        if (hash) {
            setTimeout(() => {
                const element = document.querySelector(hash);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100); // Small delay to ensure page is fully rendered
        }
    }, []);

    return (
        <div className="max-w-4xl mx-auto">
            <div className="text-center py-6">
                <h1 className="text-4xl font-bold text-slate-800 mb-4">Usage Guide</h1>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                    Learn how to effectively search and navigate through Pujya Gurudev's pravachans using Aagam-Khoj.
                </p>
            </div>

            {/* Guide Sections */}
            <div className="space-y-8">
                {guideSection.map((section, index) => (
                    <div key={index} style={{ backgroundColor: 'var(--bg-card, white)' }} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <div style={{ backgroundColor: 'var(--bg-surface, #f8fafc)' }} className="bg-slate-50 border-b border-slate-100 px-6 py-4">
                            <h2 className="text-xl font-semibold text-slate-800 flex items-center">
                                {section.icon}
                                <span className="ml-3">{section.title}</span>
                            </h2>
                        </div>
                        <div className="px-6 py-6">
                            <ul className="space-y-3">
                                {section.content.map((item, itemIndex) => (
                                    <li key={itemIndex} className="flex items-start">
                                        <span className="flex-shrink-0 w-2 h-2 bg-sky-500 rounded-full mt-2 mr-3"></span>
                                        <span className="text-slate-700">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ))}
            </div>

            {/* Typing Guide Section */}
            <TypingGuide />

            {/* Examples Section */}
            <div className="mt-12">
                <div style={{ backgroundColor: 'var(--bg-card, white)' }} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <div style={{ backgroundColor: 'var(--bg-surface, #f8fafc)' }} className="bg-slate-50 border-b border-slate-100 px-6 py-4">
                        <h2 className="text-xl font-semibold text-slate-800 flex items-center">
                            <svg className="w-6 h-6 text-amber-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            Query Examples
                        </h2>
                    </div>
                    <div className="px-6 py-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {examples.map((example, exampleIndex) => (
                                <div key={exampleIndex}>
                                    <h3 className={`text-lg font-semibold mb-4 flex items-center ${
                                        example.type === 'success' ? 'text-green-700' : 'text-red-700'
                                    }`}>
                                        {example.type === 'success' ? (
                                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        )}
                                        {example.category}
                                    </h3>
                                    <ul className="space-y-2">
                                        {example.items.map((item, itemIndex) => (
                                            <li key={itemIndex} className={`p-2 rounded-md border ${
                                                example.type === 'success' 
                                                    ? 'bg-green-50 border-green-200 text-green-800' 
                                                    : 'bg-red-50 border-red-200 text-red-800'
                                            }`}>
                                                "{item}"
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tips Section */}
            <div className="mt-12">
                <div className="bg-gradient-to-r from-blue-50 to-sky-50 rounded-lg p-8 border border-sky-100">
                    <h3 className="text-xl font-semibold text-slate-800 mb-4 flex items-center">
                        <svg className="w-6 h-6 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Pro Tips
                    </h3>
                    <ul className="space-y-2 text-slate-700">
                        <li className="flex items-start">
                            <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3"></span>
                            <span>Use the "Find Similar" button to discover related content to any search result</span>
                        </li>
                        <li className="flex items-start">
                            <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3"></span>
                            <span>Click the expand button (⤢) to see more context around any passage</span>
                        </li>
                        <li className="flex items-start">
                            <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3"></span>
                            <span>Try both keyword and semantic search tabs for comprehensive results</span>
                        </li>
                        <li className="flex items-start">
                            <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3"></span>
                            <span>Use metadata filters to search within specific series or topics</span>
                        </li>
                    </ul>
                </div>
            </div>

            {/* Call to Action */}
            <div className="mt-12 text-center">
                <div className="bg-gradient-to-r from-sky-50 to-blue-50 rounded-lg p-8 border border-sky-100">
                    <h3 className="text-xl font-semibold text-slate-800 mb-3">Ready to start exploring?</h3>
                    <p className="text-slate-600 mb-4">
                        Begin your journey through Pujya Gurudev's pravachans with these search techniques.
                    </p>
                    <button 
                        onClick={() => window.location.href = '/'}
                        className="bg-sky-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-sky-700 transition-colors duration-200 mr-4"
                    >
                        Start Searching
                    </button>
                    <button 
                        onClick={() => window.location.href = '/feedback'}
                        className="bg-slate-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-slate-700 transition-colors duration-200"
                    >
                        Share Feedback
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UsageGuide;