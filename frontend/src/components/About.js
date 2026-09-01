import React from 'react';

const About = () => {
    return (
        <div className="max-w-[1080px] mx-auto p-6">
            <div className="text-center py-6">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Swalakshya Chat</h1>
            </div>
            
            <p className="mb-8 text-gray-700 leading-relaxed">
                Swalakshya Chat is an AI-powered search platform for thousands of spiritual discourses (Pravachans) delivered by Pujya Gurudev Shri Kanji Swami. It enables users to ask Tattva-related questions in Hindi, Gujarati, or English and receive answers directly from Gurudev's Pravachans.
            </p>
            
            
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Background</h2>
            <p className="mb-4 text-gray-700 leading-relaxed">
                Gurudev Shri Kanji Swami delivered tens of thousands of Pravachans throughout his lifetime, with over 9,500 publicly available today on vitragvani.com. Many spiritual seekers (Mumukshus) begin their day by listening to them. Beyond the original scriptures by our Acharyas, Muniraaj, and Gyaani Vidvaan, his Pravachans are a unique source that comprehensively discuss the core spiritual concepts of Jain Philosophy (द्रव्यानुयोग / आध्यात्म).
            </p>

            <figure className="mb-4 md:float-right md:ml-6 md:mb-4 md:max-w-md w-full md:w-1/2">
                <img
                    src="/images/Gurudevshri_Pravachan1.jpg"
                    alt="Gurudevshri Kanji Swami delivering his daily Pravachans"
                    className="w-full rounded-lg shadow-md"
                />
                <figcaption className="text-center text-sm text-gray-600 mt-2 italic">
                    Gurudevshri Kanji Swami delivering his daily Pravachans
                </figcaption>
            </figure>

            <p className="mb-4 text-gray-700 leading-relaxed">
                His Pravachans are delivered in an accessible language and delve into fundamental topics of Jain Spirituality, such as:
            </p>
            <ul className="mb-4 ml-6 text-gray-700 list-disc">
                <li className="mb-1">Dravya-Gun-Paryay</li>
                <li className="mb-1">Nischay - Vyavhar</li>
                <li className="mb-1">Nimitt - Upadan</li>
                <li className="mb-1">Krambaddh Paryay</li>
                <li className="mb-1">Way to attain self-experience (आत्मानुभूति)</li>
            </ul>
            
            <p className="mb-8 text-gray-700 leading-relaxed">
                The importance of these Pravachans is underscored by the fact that most have been transcribed word-for-word into PDFs in both Gujarati and Hindi. This facilitates understanding for spiritual seekers (मुमुक्षु) who listen to the audio Pravachans. Together with the audio files, these Pravachan Scriptures (प्रवचन शास्त्र) are a vital source of spiritual knowledge.
            </p>
            
            
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Why Swalakshya Chat?</h2>
            <p className="mb-4 text-gray-700 leading-relaxed">
                Swalakshya Chat was developed to help spiritual seekers (मुमुक्षु) easily navigate and search through Gurudevshri's vast collection of Pravachans, aiding their spiritual study (स्वाध्याय). It is designed for spiritual seekers, researchers, and Jain Scholars (विद्वान) alike.
            </p>
            
            <ul className="mb-8 ml-6 text-gray-700 list-disc">
                <li className="mb-4">
                    <strong>Spiritual Seekers:</strong> This portal allows spiritual seekers to find answers to common questions by posing them in Hindi, English, or Gujarati. Swalakshya Chat uses AI to provide relevant answers directly from Gurudev's Pravachans. For instance, a user can ask, <strong>"दृष्टि के विषय और ज्ञान के विषय में क्या अन्तर है?"</strong> and Swalakshya Chat will provide references from Gurudev's entire catalog that address this question. Users can also search using specific keywords, such as <strong>"महात्मा गाँधी"</strong> to find all references where Gurudev mentioned Mahatma Gandhi.
                </li>
                <li className="mb-4">
                    <strong>Jain Scholars and Researchers:</strong> Gurudev's words are considered a definitive authority on Jain Spirituality. Jain Scholars and researchers frequently reference Gurudev's Pravachans to support their arguments. They also study his Pravachan Shastra for research, to learn about events in Gurudev's life, or to understand the examples he used to explain concepts.
                </li>
            </ul>
            
            
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">How Does Swalakshya Chat Work?</h2>
            <p className="mb-4 text-gray-700 leading-relaxed">
                Swalakshya Chat employs OCR technology to convert all PDF files into text files. This text is then indexed into a search-engine system (called OpenSearch). When a user enters a query, Swalakshya Chat performs two operations:
            </p>
            
            <ul className="mb-8 ml-6 text-gray-700 list-disc">
                <li className="mb-2"><strong>Keyword Search:</strong> Matches all references containing the input keywords.</li>
                <li className="mb-2"><strong>Semantic Search:</strong> Uses AI to find all relevant references that semantically match the answer to the input query.</li>
            </ul>
            
            
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Why Use Artificial Intelligence?</h2>
            <p className="mb-4 text-gray-700 leading-relaxed">
                A crucial question arises: Should artificial technology be used with such important content? Gurudev's Pravachans are akin to our Teerthankar's Vaani—how can AI be used to interpret their words?
            </p>
            <p className="mb-8 text-gray-700 leading-relaxed">
                The short answer is that AI is not used to interpret Gurudev's words or his intention. Instead, AI serves merely as a tool to identify references that <em>possibly</em> match the input questions, providing direct references from Gurudev's Pravachans. Swalakshya Chat generates answers which are strongly backed with Jain Shastras and Gurudev's Pravachans. It provides word-for-word references from these texts with each answer. This helps in finding answers from Jain Aagam easily.
            </p>
            
            
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Swa Lakshya (स्व-लक्ष्य)</h2>
            <p className="mb-4 text-gray-700 leading-relaxed">
                The sole purpose of this portal is to assist spiritual seekers (मुमुक्षु) in better understanding Jain Tattva. The author sincerely apologizes for any mistakes or shortcomings in this effort and will strive their best to correct them.
            </p>
            <p className="mb-4 text-gray-700 leading-relaxed">
                May all souls understand the true nature of their soul, achieve completeness within themselves, and attain Moksha.
            </p>
            <p className="mb-12 text-gray-700 font-semibold">
                Jai Jinendra 🙏
            </p>

            {/* Call to Action */}
            <div className="bg-gradient-to-r from-sky-50 to-blue-50 rounded-lg p-8 border border-sky-100">
                <h3 className="text-xl font-semibold text-slate-800 mb-3">Ready to explore Gurudev's Pravachans?</h3>
                <p className="text-slate-600 mb-4">
                    Continue your spiritual journey by getting your through thousands of Pravachans delivered by Pujya Gurudev Shri Kanji Swami.
                </p>
                <button 
                    onClick={() => window.location.href = '/'}
                    className="bg-sky-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-sky-700 transition-colors duration-200 mr-4"
                >
                    Start Searching
                </button>
                <button 
                    onClick={() => window.location.href = '/usage-guide'}
                    className="bg-slate-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-slate-700 transition-colors duration-200"
                >
                    View Usage Guide
                </button>
            </div>
        </div>
    );
};

export default About;