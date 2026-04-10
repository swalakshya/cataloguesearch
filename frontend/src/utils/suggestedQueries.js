/**
 * Suggested search queries shown on the home page before any search is made.
 * 5 are picked at random on each page load / language switch.
 * Add as many as you like — one per line.
 */
const SUGGESTED_QUERIES_HINDI = [
    'ज्ञान और राग कैसे भिन्न है?',
    'आत्मानुभूति का उपाय क्या है?',
    'आचार्य कुन्दकुन्द कौन थे?',
    'समयसार की महिमा क्या है?',
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

const SUGGESTED_QUERIES_GUJARATI = [
    'આત્માનુભૂતિનો ઉપાય શું છે?',
    'જ્ઞાન અને રાગ કેવી રીતે ભિન્ન છે?',
    'સાચો ધર્મ શું છે?',
    'મોક્ષમાર્ગ શું છે?',
    'સમયસારની મહિમા શું છે?',
    'નિશ્ચય અને વ્યવહાર નયમાં શું ફરક છે?',
    'આચાર્ય કુન્દકુન્દ કોણ હતા?',
    'સાચું સુખ શું છે?',
    'શ્રદ્ધા અને જ્ઞાનમાં શું ફરક છે?',
    'ચારિત્ર શું છે?',
    'કર્મ અને આત્માનો સંબંધ શું છે?',
    'સ્વભાવ અને વિભાવ શું છે?',
    'જૈન ધર્મ શું છે?',
    'દયા, દાન, પૂજા ધર્મ કેમ નથી?',
    'પરમાત્મા કોને કહેવાય?'
];

/**
 * Returns `count` queries picked at random (without repetition) for the given language.
 */
export const getRandomSuggestedQueriesByLanguage = (language = 'hindi', count = 5) => {
    const pool = language === 'gujarati' ? SUGGESTED_QUERIES_GUJARATI : SUGGESTED_QUERIES_HINDI;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
};
