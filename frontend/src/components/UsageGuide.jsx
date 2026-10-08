import React, { useEffect } from 'react';
import TypingGuide from './TypingGuide';
import { PageHeader, Card, Button } from './ui';
import { Compass, PenLine, Search, Sparkles, Check, X } from 'lucide-react';

const UsageGuide = () => {
    const guideSection = [
        {
            title: "Getting Started",
            icon: <Compass size={22} style={{ color: 'var(--color-brand)' }} />,
            content: [
                "Enter your search query in the search box at the top of the page",
                "Click the 'Search' button or press Enter to search",
                "Browse through keyword and semantic search results using the tabs",
                "Use filters to narrow down your search results by categories"
            ]
        },
        {
            title: "Writing Effective Queries",
            icon: <PenLine size={22} style={{ color: 'var(--color-info)' }} />,
            content: [
                "Write in Hindi for the most accurate results",
                "For questions or specific phrases, end with punctuation like a question mark (?) or a Purn Viram (।)",
                "If writing in English, avoid mixing in Hindi words written in the English alphabet (Hinglish)",
                "Use specific terms and concepts from the pravachans for better results"
            ]
        },
        {
            title: "Search Features",
            icon: <Search size={22} style={{ color: 'var(--color-success)' }} />,
            content: [
                "Keyword Search: Fast search that matches your exact terms",
                "Semantic Search: AI-powered search that understands context and meaning",
                "Similar Documents: Find related content to any search result",
                "Advanced Filters: Filter by categories, language, and more"
            ]
        },
        {
            title: "Advanced Options",
            icon: <Sparkles size={22} style={{ color: 'var(--color-warning)' }} />,
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
            <PageHeader
                variant="hero"
                title="Usage Guide"
                subtitle="Learn how to effectively search and navigate through Pujya Gurudev's pravachans using Swalakshya Chat."
            />

            {/* Guide Sections */}
            <div className="space-y-8">
                {guideSection.map((section, index) => (
                    <Card key={index} className="overflow-hidden">
                        <div className="bg-bg border-b border-border px-6 py-4">
                            <h2 className="text-xl font-semibold text-ink flex items-center">
                                {section.icon}
                                <span className="ml-3">{section.title}</span>
                            </h2>
                        </div>
                        <div className="px-6 py-6">
                            <ul className="space-y-3">
                                {section.content.map((item, itemIndex) => (
                                    <li key={itemIndex} className="flex items-start">
                                        <span className="list-item-dot mt-2 mr-3"></span>
                                        <span className="text-ink">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Typing Guide Section */}
            <TypingGuide />

            {/* Examples Section */}
            <div className="mt-12">
                <Card className="overflow-hidden">
                    <div className="bg-bg border-b border-border px-6 py-4">
                        <h2 className="text-xl font-semibold text-ink flex items-center">
                            <Sparkles size={22} className="mr-3" style={{ color: 'var(--color-warning)' }} />
                            Query Examples
                        </h2>
                    </div>
                    <div className="px-6 py-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {examples.map((example, exampleIndex) => (
                                <div key={exampleIndex}>
                                    <h3
                                        className="text-lg font-semibold mb-4 flex items-center"
                                        style={{ color: example.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)' }}
                                    >
                                        {example.type === 'success' ? (
                                            <Check size={18} className="mr-2" />
                                        ) : (
                                            <X size={18} className="mr-2" />
                                        )}
                                        {example.category}
                                    </h3>
                                    <ul className="space-y-2">
                                        {example.items.map((item, itemIndex) => (
                                            <li key={itemIndex} className={`notice p-2 ${example.type === 'success' ? 'notice-success' : 'notice-danger'}`} style={{ borderRadius: '0.375rem' }}>
                                                "{item}"
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            </div>

            {/* Tips Section */}
            <div className="mt-12">
                <Card className="notice-brand p-8">
                    <h3 className="text-xl font-semibold text-ink mb-4 flex items-center">
                        <Sparkles size={20} className="mr-2" style={{ color: 'var(--color-brand)' }} />
                        Pro Tips
                    </h3>
                    <ul className="space-y-2 text-ink">
                        <li className="flex items-start">
                            <span className="list-item-dot mt-2 mr-3"></span>
                            <span>Use the "Find Similar" button to discover related content to any search result</span>
                        </li>
                        <li className="flex items-start">
                            <span className="list-item-dot mt-2 mr-3"></span>
                            <span>Click the expand button (⤢) to see more context around any passage</span>
                        </li>
                        <li className="flex items-start">
                            <span className="list-item-dot mt-2 mr-3"></span>
                            <span>Try both keyword and semantic search tabs for comprehensive results</span>
                        </li>
                        <li className="flex items-start">
                            <span className="list-item-dot mt-2 mr-3"></span>
                            <span>Use metadata filters to search within specific series or topics</span>
                        </li>
                    </ul>
                </Card>
            </div>

            {/* Call to Action */}
            <div className="mt-12 text-center">
                <Card className="notice-brand p-8">
                    <h3 className="text-xl font-semibold text-ink mb-3">Ready to start exploring?</h3>
                    <p className="text-ink-muted mb-4">
                        Begin your journey through Pujya Gurudev's pravachans with these search techniques.
                    </p>
                    <div className="flex flex-wrap gap-3 justify-center">
                        <Button onClick={() => window.location.href = '/'}>
                            Start Searching
                        </Button>
                        <Button variant="secondary" onClick={() => window.location.href = '/feedback'}>
                            Share Feedback
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default UsageGuide;
