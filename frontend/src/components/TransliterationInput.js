import React, { useState, useEffect, useRef, useCallback } from 'react';

// Cap auto-grow height so a long paste doesn't take over the page -- past
// this the textarea scrolls internally instead of growing further.
const MAX_TEXTAREA_HEIGHT = 160;
const MAX_QUERY_LENGTH = 1000;

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

    // Transliteration is always disabled
    const isEnabled = false;

    // State
    const [suggestions, setSuggestions] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showDropdown, setShowDropdown] = useState(false);
    const [currentWord, setCurrentWord] = useState({ word: '', startIndex: 0, endIndex: 0 });

    // Refs
    const inputRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const dropdownRef = useRef(null);

    // Auto-focus on mount
    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    // Auto-grow the textarea to fit its content, up to MAX_TEXTAREA_HEIGHT,
    // then let it scroll internally. Re-runs on every value change, including
    // programmatic clears (e.g. after submit), so it shrinks back down too.
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    }, [value]);

    // Press '/' anywhere to focus the search input
    useEffect(() => {
        const handleSlash = (e) => {
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleSlash);
        return () => window.removeEventListener('keydown', handleSlash);
    }, []);

    // Clear input when language changes
    useEffect(() => {
        onChange('');
        setShowDropdown(false);
        setSuggestions([]);
    }, [language]);

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
        // Enter submits (matches the old single-line input); Shift+Enter inserts
        // a newline instead, same convention as most chat inputs.
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                return;
            }
            // Browsers insert a newline for Shift+Enter in a <textarea> natively,
            // but there's no such default for Cmd/Ctrl+Enter -- has to be done by hand.
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                const el = e.target;
                const start = el.selectionStart;
                const end = el.selectionEnd;
                const newValue = value.substring(0, start) + '\n' + value.substring(end);
                onChange(newValue);
                setTimeout(() => {
                    if (inputRef.current) {
                        inputRef.current.setSelectionRange(start + 1, start + 1);
                    }
                }, 0);
                return;
            }
            e.preventDefault();
            if (showDropdown && suggestions.length > 0) {
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

    return (
        <div className="relative w-full">
            <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-sm pointer-events-none select-none">🔍</span>
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={value}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    maxLength={MAX_QUERY_LENGTH}
                    style={{ scrollbarWidth: 'thin' }}
                    className={`w-full min-h-8 pl-8 pr-3 py-1 text-sm bg-white border border-slate-400 shadow-sm rounded-sm resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-600 text-slate-900 font-sans disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300 disabled:cursor-not-allowed ${className}`}
                />
            </div>
            {value.length > 0 && (
                <div className="text-right text-[10px] leading-none text-slate-400 pt-0.5 pr-1 select-none">
                    {value.length}/{MAX_QUERY_LENGTH}
                </div>
            )}

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
                                    : 'bg-white text-slate-700 hover:bg-neutral-50'
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
