import React, { useState, useEffect } from 'react';

const TypingGuide = () => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState(null);

    // Function to detect user's operating system/device
    const detectOS = () => {
        const userAgent = navigator.userAgent;
        const platform = navigator.platform;
        
        // Log for debugging
        console.log('UserAgent:', userAgent);
        console.log('Platform:', platform);

        // Mobile detection first (most specific)
        if (/Android/i.test(userAgent)) {
            return 'android';
        }
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            return 'ios';
        }

        // Windows detection (check multiple indicators)
        if (/Win/i.test(userAgent) || 
            /Win32|Win64|Windows|WinCE/i.test(platform) ||
            /Windows NT/i.test(userAgent) ||
            /Surface/i.test(userAgent)) {
            return 'windows';
        }

        // macOS detection (be more specific to avoid false positives)
        if ((/Mac/i.test(userAgent) && !/Windows/i.test(userAgent)) || 
            /MacIntel|MacPPC/i.test(platform) ||
            /Macintosh/i.test(userAgent)) {
            return 'macos';
        }

        // Linux detection
        if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) {
            return 'chrome-edge';
        }

        // Chrome OS
        if (/CrOS/i.test(userAgent)) {
            return 'chrome-edge';
        }

        // Default fallback to Chrome/Edge for unknown systems
        return 'chrome-edge';
    };

    // Auto-detect and set the appropriate tab on component mount
    useEffect(() => {
        const detectedOS = detectOS();
        setActiveTab(detectedOS);
        setIsExpanded(true); // Auto-expand the section when OS is detected
    }, []);

    const platforms = [
        {
            id: 'chrome-edge',
            label: 'Chrome/Edge Browser',
            icon: (
                <img 
                    src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/chrome/chrome-original.svg" 
                    alt="Chrome" 
                    className="w-5 h-5" 
                />
            ),
            content: {
                title: "Google Input Tools Extension",
                steps: [
                    "Open Chrome or Edge browser",
                    {
                        text: "Go to Chrome Web Store and install Google Input Tools",
                        link: "https://chromewebstore.google.com/detail/google-input-tools/mclkkofklkfljcocdinagocijmpgbhab"
                    },
                    "After installation, click the extension icon in the toolbar",
                    "Select 'Extension Options' to configure languages",
                    "Add Hindi (हिन्दी) and/or Gujarati (ગુજરાતી) from the language list",
                    "Save your settings and close the options tab"
                ],
                usage: [
                    "Click the Google Input Tools icon in your browser toolbar",
                    "Select Hindi or Gujarati from the language dropdown",
                    "Start typing in the search box - your English text will convert to Hindi/Gujarati",
                    "Use spacebar or arrow keys to select the correct word from suggestions",
                    "To switch back to English, click the extension icon and select 'English'"
                ]
            }
        },
        {
            id: 'android',
            label: 'Android',
            icon: (
                <img 
                    src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/android/android-original.svg" 
                    alt="Android" 
                    className="w-5 h-5" 
                />
            ),
            content: {
                title: "Gboard Keyboard Setup",
                steps: [
                    "Open your Android Settings app",
                    "Go to 'System' > 'Languages & input' > 'Virtual keyboard'",
                    {
                        text: "Select 'Gboard' (or install from Play Store if not available)",
                        link: "https://play.google.com/store/apps/details?id=com.google.android.inputmethod.latin"
                    },
                    "Tap 'Languages' in Gboard settings",
                    "Tap 'Add keyboard' and select 'Hindi' or 'Gujarati'",
                    "Choose your preferred input method (e.g., 'Hindi (Devanagari)' or 'Gujarati')",
                    "Enable the keyboard and set it as active"
                ],
                usage: [
                    "Open any app where you want to type (like your browser)",
                    "Tap in a text field to open the keyboard",
                    "Long-press the spacebar or tap the globe/language icon",
                    "Select Hindi or Gujarati from the language options",
                    "Start typing in English - Gboard will suggest Hindi/Gujarati words",
                    "Tap suggestions or use gesture typing for faster input"
                ]
            }
        },
        {
            id: 'ios',
            label: 'iOS',
            icon: (
                <img 
                    src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/apple/apple-original.svg" 
                    alt="iOS" 
                    className="w-5 h-5" 
                />
            ),
            content: {
                title: "Built-in Keyboard Setup",
                steps: [
                    {
                        text: "Open iPhone/iPad Settings",
                        link: null
                    },
                    "Tap 'General' > 'Keyboard' > 'Keyboards'",
                    "Tap 'Add New Keyboard...'",
                    "Scroll down and select 'Hindi' or 'Gujarati'",
                    "Choose your preferred input method (e.g., 'Hindi (Devanagari)' or 'Gujarati')",
                    "Tap 'Done' to save the keyboard",
                    "The new keyboard is now available across all apps"
                ],
                usage: [
                    "Open Safari or any app where you want to type",
                    "Tap in a text field to open the keyboard",
                    "Tap and hold the globe icon (🌐) at the bottom left",
                    "Select Hindi or Gujarati from the popup menu",
                    "Start typing in English - iOS will suggest Hindi/Gujarati words",
                    "Tap suggestions to select the correct word",
                    "Tap the globe icon again to switch back to English"
                ]
            }
        },
        {
            id: 'windows',
            label: 'Windows',
            icon: (
                <img 
                    src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows8/windows8-original.svg" 
                    alt="Windows" 
                    className="w-5 h-5" 
                />
            ),
            content: {
                title: "Windows Input Method Setup",
                steps: [
                    {
                        text: "Click on Start menu and open 'Settings'",
                        link: null
                    },
                    "Go to 'Time & Language' > 'Language & region'",
                    "Click 'Add a language' button",
                    "Search for and select 'Hindi' or 'Gujarati'",
                    "Click 'Next' and then 'Install' to download the language pack",
                    "After installation, click on the language and select 'Options'",
                    "Add the preferred keyboard layout (e.g., 'Hindi Traditional' or 'Gujarati')"
                ],
                usage: [
                    "Look for the language indicator in your taskbar (usually shows 'ENG')",
                    "Click on it or press Windows + Space to switch languages",
                    "Select Hindi (HIN) or Gujarati (GUJ) from the list",
                    "Open your web browser and go to the Swalakshya Chat search page",
                    "Start typing in English - Windows will convert to Hindi/Gujarati script",
                    "Use spacebar to accept suggestions or continue typing",
                    "Press Windows + Space again to switch back to English"
                ]
            }
        },
        {
            id: 'macos',
            label: 'macOS',
            icon: (
                <img 
                    src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/apple/apple-original.svg" 
                    alt="macOS" 
                    className="w-5 h-5" 
                />
            ),
            content: {
                title: "Input Source Configuration",
                steps: [
                    {
                        text: "Open System Preferences/Settings",
                        link: null
                    },
                    "Click on 'Keyboard' settings",
                    "Go to 'Text Input' or 'Input Sources' tab",
                    "Click the '+' button to add a new input source",
                    "Select 'Hindi' or 'Gujarati' from the language list",
                    "Choose the input method (e.g., 'Devanagari - QWERTY' for Hindi)",
                    "Click 'Add' to enable the input source",
                    "Optionally, enable 'Show input menu in menu bar' for easy access"
                ],
                usage: [
                    "Look for the input source icon in your menu bar (top-right corner)",
                    "Click on it or press Control + Space (or Command + Space) to switch",
                    "Select Hindi or Gujarati from the dropdown menu",
                    "Open your web browser and navigate to Swalakshya Chat",
                    "Start typing in the search box - macOS will convert English to Hindi/Gujarati",
                    "Use spacebar to accept suggestions from the candidate window",
                    "Switch back to English using the menu bar icon or keyboard shortcut"
                ]
            }
        }
    ];

    const handleTabClick = (tabId) => {
        if (activeTab === tabId) {
            setActiveTab(null);
        } else {
            setActiveTab(tabId);
            if (!isExpanded) {
                setIsExpanded(true);
            }
        }
    };

    const toggleSection = () => {
        setIsExpanded(!isExpanded);
        if (!isExpanded) {
            setActiveTab(null);
        }
    };

    return (
        <div id="typing-guide" className="mt-12">
            {/* Importance Message - Always Visible */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-start">
                    <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <h3 className="font-semibold text-blue-800 mb-2">Important for Better Results</h3>
                        <p className="text-blue-700">
                            Typing your queries in Hindi (हिन्दी) or Gujarati (ગુજરાતી) significantly improves search accuracy and relevance. 
                            The AI system is specifically trained on content in these languages and will provide much better results 
                            when queries match the original language of the pravachans.
                        </p>
                    </div>
                </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-card, white)' }} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header */}
                <div
                    className="bg-amber-50 border-b border-amber-100 px-6 py-4 cursor-pointer hover:bg-amber-100 transition-colors duration-200"
                    onClick={toggleSection}
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold text-amber-800 flex items-center">
                            <svg className="w-6 h-6 text-amber-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            Typing in Hindi/Gujarati
                        </h2>
                        <svg 
                            className={`w-5 h-5 text-amber-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>

                {/* Content */}
                {isExpanded && (
                    <div className="px-6 py-6">

                        {/* Platform Tabs */}
                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-slate-800 mb-4">Setup Guide for Your Device:</h3>
                            
                            {/* Auto-detection notice */}
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                                <div className="flex items-center text-sm text-green-700">
                                    <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>
                                        We've detected your device and opened the relevant setup guide below. You can click on other platforms if needed.
                                    </span>
                                </div>
                            </div>
                            
                            {platforms.map((platform) => (
                                <div key={platform.id} className="border border-slate-200 rounded-lg">
                                    {/* Tab Header */}
                                    <button
                                        onClick={() => handleTabClick(platform.id)}
                                        className={`w-full px-4 py-3 text-left flex items-center justify-between transition-colors duration-200 rounded-lg ${
                                            activeTab === platform.id 
                                                ? 'bg-sky-50 text-sky-800 border-sky-200' 
                                                : 'hover:bg-neutral-50 text-slate-700'
                                        }`}
                                    >
                                        <div className="flex items-center">
                                            <span className={`mr-3 ${activeTab === platform.id ? 'text-sky-600' : 'text-slate-500'}`}>
                                                {platform.icon}
                                            </span>
                                            <span className="font-medium">{platform.label}</span>
                                        </div>
                                        <svg 
                                            className={`w-4 h-4 transition-transform duration-200 ${
                                                activeTab === platform.id ? 'rotate-180 text-sky-600' : 'text-slate-400'
                                            }`} 
                                            fill="none" 
                                            stroke="currentColor" 
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {/* Tab Content */}
                                    {activeTab === platform.id && (
                                        <div style={{ backgroundColor: 'var(--bg-surface, #f8fafc)' }} className="px-4 pb-4 pt-2 bg-slate-50 border-t border-slate-200">
                                            <div className="space-y-6">
                                                {/* Setup Steps */}
                                                <div>
                                                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center">
                                                        <svg className="w-4 h-4 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                                                        </svg>
                                                        {platform.content.title} - Setup Steps:
                                                    </h4>
                                                    <ol className="space-y-2">
                                                        {platform.content.steps.map((step, index) => (
                                                            <li key={index} className="flex items-start">
                                                                <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-sm font-medium mr-3 mt-0.5">
                                                                    {index + 1}
                                                                </span>
                                                                <span className="text-slate-700">
                                                                    {typeof step === 'string' ? (
                                                                        step
                                                                    ) : (
                                                                        step.link ? (
                                                                            <>
                                                                                {step.text.split('(')[0]}
                                                                                <a 
                                                                                    href={step.link} 
                                                                                    target="_blank" 
                                                                                    rel="noopener noreferrer"
                                                                                    className="text-sky-600 hover:text-sky-800 underline font-medium mx-1"
                                                                                >
                                                                                    {step.link.includes('chromewebstore') ? 'Chrome Web Store' : 
                                                                                     step.link.includes('play.google.com') ? 'Google Play Store' : 
                                                                                     'Official Link'}
                                                                                </a>
                                                                                {step.text.includes('(') && `(${step.text.split('(')[1]}`}
                                                                            </>
                                                                        ) : (
                                                                            step.text
                                                                        )
                                                                    )}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                </div>

                                                {/* Usage Instructions */}
                                                <div>
                                                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center">
                                                        <svg className="w-4 h-4 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                        </svg>
                                                        How to Use:
                                                    </h4>
                                                    <ul className="space-y-2">
                                                        {platform.content.usage.map((instruction, index) => (
                                                            <li key={index} className="flex items-start">
                                                                <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3"></span>
                                                                <span className="text-slate-700">{instruction}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TypingGuide;