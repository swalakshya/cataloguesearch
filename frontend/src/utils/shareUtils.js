// Share utilities for Aagam-Khoj search results

// Generate shareable URL for a specific search result
export const generateShareURL = () => {
    return window.location.origin;
};

// Format Granth share content
export const formatGranthShareContent = (query, result, shareUrl) => {
    const cleanContent = result?.content_snippet
        ? result.content_snippet.replace(/<[^>]*>/g, '').trim()
        : 'Search result from Aagam-Khoj';

    const granthName = result?.metadata?.Name || result?.filename?.replace('.pdf', '') || 'Unknown Granth';
    const author = result?.metadata?.Author || '';
    const tikakaar = result?.metadata?.Tikakaar || '';
    const subSection = result?.metadata?.sub_section || null;

    // Build location string from whichever of gatha/kalash/shlok are present
    const locationParts = [];
    if (result?.gatha) locationParts.push(`Gatha ${result.gatha}`);
    if (result?.kalash) locationParts.push(`Kalash ${result.kalash}`);
    if (result?.shlok) locationParts.push(`Shlok ${result.shlok}`);
    const locationInfo = locationParts.join(', ');

    return {
        title: `Found in Aagam-Khoj: "${query}"`,
        text: `Query: ${query}\n\nExtract: "${cleanContent}"\n\nGranth: ${granthName}${subSection ? `\n\n${subSection.field}: ${subSection.name}` : ''}\n\nAuthor: ${author}\n\nLocation: ${locationInfo}\n\nSearch more at: ${shareUrl}`,
        url: shareUrl,
        isGranth: true,
        granthName,
        author,
        tikakaar,
        locationInfo,
        subSection
    };
};

// Format Pravachan share content
export const formatPravachanShareContent = (query, result, shareUrl, language = 'hindi') => {
    const cleanContent = result?.content_snippet
        ? result.content_snippet.replace(/<[^>]*>/g, '').trim()
        : 'Search result from Aagam-Khoj';

    const granth = result?.metadata?.Name || 'Unknown Source';
    const series = result?.metadata?.Series || '';
    const pageNumber = result?.page_number || '';
    const filename = result?.original_filename ? result.original_filename.split('/').pop() : '';
    const pravachankar = result?.Pravachankar || 'Unknown';

    // Build pravachan details
    let pravachanDetails = '';
    if (series) pravachanDetails += `${series}, `;
    pravachanDetails += filename;
    pravachanDetails += `, Page ${pageNumber}`;

    // Language-specific labels
    const pravachankarLabel = language === 'gujarati' ? 'પ્રવચનકાર' : 'प्रवचनकार';

    return {
        title: `Found in Aagam-Khoj: "${query}"`,
        text: `Query: ${query}\n\nExtract: "${cleanContent}"\n\nGranth: ${granth}\n\n${pravachankarLabel}: ${pravachankar}\n\nPravachan Details: ${pravachanDetails}\n\nSearch more at: ${shareUrl}`,
        url: shareUrl,
        isGranth: false,
        granth,
        pravachankar,
        pravachanDetails,
        pravachankarLabel
    };
};

// Main dispatcher function - determines result type and calls appropriate formatter
export const formatShareContent = (query, result, shareUrl, language = 'hindi') => {
    const isGranthResult = result?.metadata?.category === 'Granth';

    if (isGranthResult) {
        return formatGranthShareContent(query, result, shareUrl);
    } else {
        return formatPravachanShareContent(query, result, shareUrl, language);
    }
};

// Copy to clipboard function
export const copyToClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
        }
    }
    
    // Fallback for older browsers
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (error) {
        console.error('Fallback copy failed:', error);
        return false;
    }
};

// Track share events for analytics
export const trackShareEvent = (method, query, resultId) => {
    // Track share usage (can be integrated with analytics)
    console.log('Share event:', { method, query, resultId });
    
    // If you have Google Analytics or other analytics
    // gtag('event', 'share', {
    //     method: method,
    //     content_type: 'search_result',
    //     item_id: resultId
    // });
};