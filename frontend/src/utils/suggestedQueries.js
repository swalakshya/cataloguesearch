/**
 * Suggested search queries shown on the home page before any search is made.
 * 5 are picked at random on each page load.
 * Add as many as you like — one per line.
 */
const SUGGESTED_QUERIES = [
    'ज्ञान और राग कैसे भिन्न है?',
    'आत्मानुभूति का उपाय क्या है?',
    'आचार्य कुन्दकुन्द कौन थे?',
    'समयसार की महिमा',
    'स्वपरप्रकाशक ज्ञान क्या है?',
    'श्रद्धा और ज्ञान में क्या फ़र्क़ है?',
    'निश्चय और व्यवहार नय में क्या अंतर है?',
    'सच्चा धर्म क्या है?',
    'सच्चा सुख क्या है?',
    'जैन धर्म क्या है?',
    'दया, दान, पूजा धर्म क्यों नहीं है?',
    'आचार्य कुन्दकुन्द की विदेह क्षेत्र यात्रा',
    'मोक्षमार्ग क्या है?',
    'चारित्र क्या है?',
    'विकल्प और विचार में क्या अन्तर है?'
];

/**
 * Returns `count` queries picked at random (without repetition).
 */
export const getRandomSuggestedQueries = (count = 5) => {
    const shuffled = [...SUGGESTED_QUERIES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
};
