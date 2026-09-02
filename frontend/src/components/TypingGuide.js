import React, { useState, useEffect } from 'react';
import { Info, CheckCircle2, Zap, ChevronDown } from 'lucide-react';
import { Card } from './ui';

const TypingGuide = () => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState(null);

    // Function to detect user's operating system/device
    const detectOS = () => {
        const userAgent = navigator.userAgent;
        const platform = navigator.platform;

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
            <div className="notice notice-info mb-4">
                <div className="flex items-start">
                    <Info size={20} className="mt-0.5 mr-3 flex-shrink-0" style={{ color: 'var(--color-info)' }} />
                    <div>
                        <h3 className="font-semibold mb-2" style={{ color: 'var(--color-info)' }}>Important for Better Results</h3>
                        <p className="text-ink">
                            Typing your queries in Hindi (हिन्दी) or Gujarati (ગુજરાતી) significantly improves search accuracy and relevance.
                            The AI system is specifically trained on content in these languages and will provide much better results
                            when queries match the original language of the pravachans.
                        </p>
                    </div>
                </div>
            </div>

            <Card className="overflow-hidden">
                {/* Header */}
                <div
                    className="notice-brand px-6 py-4 cursor-pointer transition-colors duration-200"
                    style={{ borderRadius: 0 }}
                    onClick={toggleSection}
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold flex items-center" style={{ color: 'var(--color-brand)' }}>
                            <Zap size={22} className="mr-3" />
                            Typing in Hindi/Gujarati
                        </h2>
                        <ChevronDown
                            size={20}
                            className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            style={{ color: 'var(--color-brand)' }}
                        />
                    </div>
                </div>

                {/* Content */}
                {isExpanded && (
                    <div className="px-6 py-6">

                        {/* Platform Tabs */}
                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-ink mb-4">Setup Guide for Your Device:</h3>

                            {/* Auto-detection notice */}
                            <div className="notice notice-success mb-4 p-3">
                                <div className="flex items-center text-sm" style={{ color: 'var(--color-success)' }}>
                                    <CheckCircle2 size={16} className="mr-2 flex-shrink-0" />
                                    <span>
                                        We've detected your device and opened the relevant setup guide below. You can click on other platforms if needed.
                                    </span>
                                </div>
                            </div>

                            {platforms.map((platform) => (
                                <div key={platform.id} className="border border-border rounded-lg">
                                    {/* Tab Header */}
                                    <button
                                        onClick={() => handleTabClick(platform.id)}
                                        className="w-full px-4 py-3 text-left flex items-center justify-between transition-colors duration-200 rounded-lg"
                                        style={activeTab === platform.id
                                            ? { backgroundColor: 'color-mix(in srgb, var(--color-brand) 8%, var(--color-surface))', color: 'var(--color-brand)' }
                                            : { color: 'var(--color-ink)' }}
                                    >
                                        <div className="flex items-center">
                                            <span className="mr-3">
                                                {platform.icon}
                                            </span>
                                            <span className="font-medium">{platform.label}</span>
                                        </div>
                                        <ChevronDown
                                            size={16}
                                            className={`transition-transform duration-200 ${activeTab === platform.id ? 'rotate-180' : ''}`}
                                            style={{ color: activeTab === platform.id ? 'var(--color-brand)' : 'var(--color-ink-muted)' }}
                                        />
                                    </button>

                                    {/* Tab Content */}
                                    {activeTab === platform.id && (
                                        <div className="px-4 pb-4 pt-2 bg-bg border-t border-border">
                                            <div className="space-y-6">
                                                {/* Setup Steps */}
                                                <div>
                                                    <h4 className="font-semibold text-ink mb-3 flex items-center">
                                                        <CheckCircle2 size={16} className="mr-2" style={{ color: 'var(--color-success)' }} />
                                                        {platform.content.title} - Setup Steps:
                                                    </h4>
                                                    <ol className="space-y-2">
                                                        {platform.content.steps.map((step, index) => (
                                                            <li key={index} className="flex items-start">
                                                                <span
                                                                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium mr-3 mt-0.5"
                                                                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 16%, var(--color-surface))', color: 'var(--color-success)' }}
                                                                >
                                                                    {index + 1}
                                                                </span>
                                                                <span className="text-ink">
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
                                                                                    className="text-brand hover:text-brand-hover underline font-medium mx-1"
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
                                                    <h4 className="font-semibold text-ink mb-3 flex items-center">
                                                        <Zap size={16} className="mr-2" style={{ color: 'var(--color-info)' }} />
                                                        How to Use:
                                                    </h4>
                                                    <ul className="space-y-2">
                                                        {platform.content.usage.map((instruction, index) => (
                                                            <li key={index} className="flex items-start">
                                                                <span className="list-item-dot mt-2 mr-3" style={{ backgroundColor: 'var(--color-info)' }}></span>
                                                                <span className="text-ink">{instruction}</span>
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
            </Card>
        </div>
    );
};

export default TypingGuide;
