import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * TransliterationInput - A standalone, reusable input component with real-time transliteration
 *
 * Features:
 * - Toggle transliteration on/off (persists in localStorage)
 * - Real-time suggestions as user types English text
 * - Keyboard navigation (↑↓ arrows, Enter, Escape, Tab, Space)
 * - Auto-selection on space, tab, and punctuation
 * - Word-by-word transliteration
 * - Mobile responsive with adaptive placeholder text
 * - First-time tooltip with pulse animation
 * - Language-aware UI (Hindi/Gujarati)
 *
 * @param {Object} props
 * @param {string} props.value - Controlled input value
 * @param {function} props.onChange - Callback when value changes: (newValue) => void
 * @param {function} props.onSearch - Callback when search is triggered (Enter key): () => void
 * @param {string} props.language - Target language: 'hindi' or 'gujarati'
 * @param {string} [props.apiBaseUrl='/api'] - Base URL for transliteration API
 * @param {string} [props.placeholder='Enter your search query...'] - Input placeholder (when OFF)
 * @param {string} [props.className=''] - Additional CSS classes for input
 * @param {boolean} [props.autoFocus=false] - Whether to autofocus input on mount
 * @param {boolean} [props.disabled=false] - Whether input is disabled
 * @param {number} [props.topk=5] - Number of transliteration suggestions
 * @param {number} [props.debounceMs=200] - Debounce delay in milliseconds
 * @param {string} [props.storageKey='transliterationEnabled'] - localStorage key for toggle state
 */
const TransliterationInput = ({
    value,
    onChange,
    onSearch,
    language,
    apiBaseUrl = '/api',
    placeholder = 'Enter your search query...',
    className = '',
    autoFocus = false,
    disabled = false,
    topk = 5,
    debounceMs = 200,
    storageKey = 'transliterationEnabled'
}) => {
    // Language code mapping
    const langCodeMap = {
        'hindi': 'hi',
        'gujarati': 'gu'
    };

    // Language display configuration
    const languageConfig = {
        'hindi': {
            symbol: 'A→अ',
            name: 'Hindi',
            nameNative: 'हिंदी',
            exampleTransformed: 'स्वलक्ष्य',
            exampleWord: 'swalakshya',
            placeholderDesktop: 'Type Hindi words with English letters... (swalakshya → स्वलक्ष्य)',
            placeholderMobile: 'swalakshya → स्वलक्ष्य',
            tooltipText: 'Type Hindi words using English letters! Try: swalakshya'
        },
        'gujarati': {
            symbol: 'A→અ',
            name: 'Gujarati',
            nameNative: 'ગુજરાતી',
            exampleTransformed: 'સ્વલક્ષ્ય',
            exampleWord: 'swalakshya',
            placeholderDesktop: 'Type Gujarati words with English letters... (swalakshya → સ્વલક્ષ્ય)',
            placeholderMobile: 'swalakshya → સ્વલક્ષ્ય',
            tooltipText: 'Type Gujarati words using English letters! Try: swalakshya'
        }
    };

    // Get current language config
    const currentLangConfig = languageConfig[language] || languageConfig['hindi'];

    // State
    const [isEnabled, setIsEnabled] = useState(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            return stored === 'true';
        } catch {
            return false;
        }
    });
    const [suggestions, setSuggestions] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showDropdown, setShowDropdown] = useState(false);
    const [currentWord, setCurrentWord] = useState({ word: '', startIndex: 0, endIndex: 0 });
    const [showTooltip, setShowTooltip] = useState(() => {
        try {
            const hasSeenTooltip = localStorage.getItem('transliterationTooltipSeen');
            return !hasSeenTooltip;
        } catch {
            return false;
        }
    });
    const [isMobile, setIsMobile] = useState(false);

    // Refs
    const inputRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const dropdownRef = useRef(null);
    const tooltipRef = useRef(null);

    // Detect mobile screen size
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Auto-focus on mount
    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    // Clear input when language changes
    useEffect(() => {
        onChange('');
        setShowDropdown(false);
        setSuggestions([]);
    }, [language]);

    // Show tooltip after a delay on first visit
    useEffect(() => {
        if (showTooltip && !isEnabled) {
            const timer = setTimeout(() => {
                // Tooltip is already visible, this is just for potential future animations
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [showTooltip, isEnabled]);

    // Global "/" key to focus input
    useEffect(() => {
        const handleKeyPress = (event) => {
            if (event.key === '/' &&
                !['INPUT', 'TEXTAREA'].includes(event.target.tagName) &&
                inputRef?.current) {
                event.preventDefault();
                inputRef.current.focus();
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, []);

    // Persist toggle state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(storageKey, isEnabled.toString());
        } catch (error) {
            console.warn('Could not save transliteration state to localStorage:', error);
        }
    }, [isEnabled, storageKey]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
                inputRef.current && !inputRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Close tooltip when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (tooltipRef.current && !tooltipRef.current.contains(event.target)) {
                handleDismissTooltip();
            }
        };

        if (showTooltip) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showTooltip]);

    // Extract English suffix at cursor position (for compound words like "कुंदkund")
    const extractCurrentWord = useCallback((text, cursorPosition) => {
        // Define word boundaries (space and punctuation)
        const boundaries = /[\s,\.?!;:]/;

        // Find the English suffix starting from cursor and going backwards
        // Stop at: boundary, non-English character, or start of string
        let startIndex = cursorPosition;
        while (startIndex > 0 &&
               !boundaries.test(text[startIndex - 1]) &&
               /[a-zA-Z]/.test(text[startIndex - 1])) {
            startIndex--;
        }

        // Find end of current English suffix (go forward from cursor)
        let endIndex = cursorPosition;
        while (endIndex < text.length &&
               !boundaries.test(text[endIndex]) &&
               /[a-zA-Z]/.test(text[endIndex])) {
            endIndex++;
        }

        const word = text.substring(startIndex, endIndex);
        return { word, startIndex, endIndex };
    }, []);

    // Check if text contains only English characters
    const isEnglishOnly = useCallback((text) => {
        return /^[a-zA-Z]+$/.test(text);
    }, []);

    // Call transliteration API
    const fetchTransliteration = useCallback(async (word, targetLang) => {
        if (!word || word.length < 2) {
            setSuggestions([]);
            setShowDropdown(false);
            return;
        }

        try {
            const langCode = langCodeMap[targetLang] || 'hi';
            const response = await fetch(
                `${apiBaseUrl}/tl/${langCode}/${encodeURIComponent(word)}?topk=${topk}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const suggestionList = Array.isArray(data) ? data : [];

            if (suggestionList.length > 0) {
                setSuggestions(suggestionList);
                setSelectedIndex(0);
                setShowDropdown(true);
            } else {
                setSuggestions([]);
                setShowDropdown(false);
            }
        } catch (error) {
            console.error('Transliteration API error:', error);
            setSuggestions([]);
            setShowDropdown(false);
        }
    }, [apiBaseUrl, topk, langCodeMap]);

    // Replace current word with suggestion
    const replaceWithSuggestion = useCallback((suggestion, addChar = '') => {
        const text = value;
        const { startIndex, endIndex } = currentWord;

        const before = text.substring(0, startIndex);
        const after = text.substring(endIndex);
        const newValue = before + suggestion + addChar + after;

        onChange(newValue);

        // Set cursor position after the replaced word
        setTimeout(() => {
            if (inputRef.current) {
                const newCursorPos = startIndex + suggestion.length + addChar.length;
                inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);

        setShowDropdown(false);
        setSuggestions([]);
    }, [value, currentWord, onChange]);

    // Handle input change
    const handleInputChange = (e) => {
        const newValue = e.target.value;
        onChange(newValue);

        // Clear any pending debounce timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // If transliteration is disabled, don't process
        if (!isEnabled) {
            setShowDropdown(false);
            return;
        }

        // Get cursor position
        const cursorPosition = e.target.selectionStart;

        // Extract current word
        const wordInfo = extractCurrentWord(newValue, cursorPosition);
        setCurrentWord(wordInfo);

        // Check if current word is English only
        if (!isEnglishOnly(wordInfo.word)) {
            setShowDropdown(false);
            setSuggestions([]);
            return;
        }

        // Debounce API call
        debounceTimerRef.current = setTimeout(() => {
            fetchTransliteration(wordInfo.word, language);
        }, debounceMs);
    };

    // Handle key down events
    const handleKeyDown = (e) => {
        // Enter key
        if (e.key === 'Enter') {
            if (showDropdown && suggestions.length > 0) {
                e.preventDefault();
                replaceWithSuggestion(suggestions[selectedIndex]);
            } else if (onSearch) {
                onSearch();
            }
            return;
        }

        // Escape key - close dropdown
        if (e.key === 'Escape') {
            setShowDropdown(false);
            return;
        }

        // Arrow down - navigate suggestions
        if (e.key === 'ArrowDown' && showDropdown) {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % suggestions.length);
            return;
        }

        // Arrow up - navigate suggestions
        if (e.key === 'ArrowUp' && showDropdown) {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
            return;
        }

        // Tab or Space - auto-select highlighted suggestion
        if ((e.key === 'Tab' || e.key === ' ') && showDropdown && suggestions.length > 0) {
            e.preventDefault();
            replaceWithSuggestion(suggestions[selectedIndex], e.key === ' ' ? ' ' : '');
            return;
        }

        // Punctuation - auto-select highlighted suggestion and add punctuation
        const punctuation = [',', '.', '?', '!', ';', ':'];
        if (punctuation.includes(e.key) && showDropdown && suggestions.length > 0) {
            e.preventDefault();
            replaceWithSuggestion(suggestions[selectedIndex], e.key);
            return;
        }
    };

    // Handle suggestion click
    const handleSuggestionClick = (suggestion) => {
        replaceWithSuggestion(suggestion);
    };

    // Toggle transliteration
    const handleToggle = () => {
        setIsEnabled(prev => !prev);
        if (isEnabled) {
            // If turning off, hide dropdown
            setShowDropdown(false);
            setSuggestions([]);
        }
        // Dismiss tooltip when user interacts with toggle
        handleDismissTooltip();
    };

    // Dismiss tooltip
    const handleDismissTooltip = () => {
        setShowTooltip(false);
        try {
            localStorage.setItem('transliterationTooltipSeen', 'true');
        } catch (error) {
            console.warn('Could not save tooltip state to localStorage:', error);
        }
    };

    // Get dynamic placeholder based on state and screen size
    const getDynamicPlaceholder = () => {
        if (!isEnabled) {
            return placeholder;
        }
        return isMobile ? currentLangConfig.placeholderMobile : currentLangConfig.placeholderDesktop;
    };

    return (
        <div className="relative w-full">
            {/* Input with toggle button */}
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={getDynamicPlaceholder()}
                    disabled={disabled}
                    className={`w-full p-3 pl-4 pr-20 text-sm md:text-lg bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-900 font-sans ${className}`}
                />

                {/* Toggle Button */}
                <button
                    type="button"
                    onClick={handleToggle}
                    disabled={disabled}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 flex items-center justify-center rounded-lg transition-all duration-300 font-semibold text-sm ${
                        isEnabled
                            ? 'bg-green-500 text-white hover:bg-green-600 shadow-md'
                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
                        showTooltip && !isEnabled ? 'animate-pulse' : ''
                    }`}
                    title={isEnabled ? `${currentLangConfig.name} typing enabled` : `Enable ${currentLangConfig.name} typing`}
                >
                    <span className="whitespace-nowrap">
                        {currentLangConfig.symbol}
                    </span>
                </button>

                {/* First-time Tooltip */}
                {showTooltip && !isEnabled && (
                    <div
                        ref={tooltipRef}
                        className="absolute top-full right-0 mt-2 w-64 bg-slate-800 text-white rounded-lg shadow-xl p-3 z-50 animate-fadeIn"
                        style={{
                            animation: 'fadeIn 0.3s ease-in-out'
                        }}
                    >
                        {/* Arrow pointing to toggle button */}
                        <div className="absolute -top-2 right-6 w-4 h-4 bg-slate-800 transform rotate-45"></div>

                        <div className="relative">
                            {/* Close button */}
                            <button
                                onClick={handleDismissTooltip}
                                className="absolute -top-2 -right-2 text-slate-400 hover:text-white transition-colors"
                                aria-label="Close tooltip"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>

                            <div className="pr-4">
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-2xl">💡</span>
                                    <div>
                                        <p className="font-semibold text-sm mb-1">
                                            {currentLangConfig.tooltipText}
                                        </p>
                                        <p className="text-xs text-slate-300">
                                            Click {currentLangConfig.symbol} above to enable
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Suggestions Dropdown */}
            {showDropdown && suggestions.length > 0 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                >
                    {suggestions.map((suggestion, index) => (
                        <div
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className={`px-4 py-2 cursor-pointer transition-colors ${
                                index === selectedIndex
                                    ? 'bg-sky-100 text-sky-900'
                                    : 'bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            <span className="text-lg">{suggestion}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* CSS for fade-in animation */}
            <style>{`
                @keyframes fadeIn {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.3s ease-in-out;
                }
            `}</style>
        </div>
    );
};

export default TransliterationInput;
