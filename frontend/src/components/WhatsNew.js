import React from 'react';
import { Zap, FileText } from 'lucide-react';
import { PageHeader, Card, Button } from './ui';

const WhatsNew = () => {
    // Helper function to render content with optional links
    const renderContent = (item) => {
        if (typeof item === 'string') {
            return <span className="text-ink">{item}</span>;
        } else if (item.link) {
            const isExternalLink = item.link.startsWith('http') || item.link.startsWith('//');
            return (
                <span className="text-ink">
                    {item.text}{' '}
                    <a
                        href={item.link}
                        target={isExternalLink ? "_blank" : "_self"}
                        rel={isExternalLink ? "noopener noreferrer" : undefined}
                        className="text-brand hover:text-brand-hover underline font-medium"
                    >
                        {item.linkText || 'Learn more'}
                    </a>
                </span>
            );
        }
        return <span className="text-ink">{item.text}</span>;
    };

    const updates = [
        {
            date: "August 30, 2026",
            newContent: [
                "Granths: Rayansaar by Acharya Kund Kund",
                "Granths: Gautam Charitra by Mandalacharya Shri Dharmchandra",
                "Granths: Maharani Chelna by Br. Harilal Jain",
                "Granths: Aadi Puran by Acharya Jinsen",
                "Granths: Uttar Puran by Acharya Gunbhadra",
                "Granths: Shrenik Charitra by Bhattarak Shubhchandra",
                "Granths: Swanubhuti Darshan by Bahinshree Champaben",
                "Pravachans: Niyamsaar 1975-76 Series (Hindi, 183 Pravachans)",
            ],
        },
        {
            date: "August 29, 2026",
            newContent: [
                "Granths: Padma Puran (Gujarati) by Acharya Ravisen (Tikakaar: Pandit Daulatram)",
                "Granths: Gommatsaar Jeevkand by Acharya Nemichand Siddhant Chakravarti (Tikakaar: Pandit Keshav Varni)",
                "Granths: Gommatsaar Karmkand by Acharya Nemichand Siddhant Chakravarti (Tikakaar: Pandit Keshav Varni)",
                "Granths: Triloksaar by Acharya Nemichand Siddhant Chakravarti (Tikakaar: Pandit Todarmal)",
                "Pravachans: Pravachan Navneet (142 Pravachans, Hindi)",
                "Pravachans: Asht Pahud 1973-74 Series (198 Pravachans, Hindi)",
                "Pravachans: Bahinshree Nu Vachanamrut 1980 Series (50 Pravachans, Hindi)",
                "Pravachans: Parmatma Prakash 1965-66 Series (214 Pravachans, Hindi)",
                "Granths: Bhagwan Hanuman by Br. Harilal Jain",
                "Granths: Bhagwan Parshvanath by Br. Harilal Jain",
                "Granths: Bhagwan Shantinath by Br. Harilal Jain",
                "Granths: Bhartesh Vaibhav by Mahakavi Ratnakar Varni",
            ],
        },
        {
            date: "April 30, 2026",
            newContent: [
                "Pravachans: Samaysaar 1971-74 (17th time) in Gujarati — 639 Pravachans",
            ],
        },
        {
            date: "April 28, 2026",
            newContent: [
                "Granths: Yogsaar by Acharya Amitgati",
                "Granths: Varasanuvekkha by Acharya Kund Kund",
                "Granths: Tattvanushashan by Muni Nagsen",
                "Granths: Sukumal Charitra by Acharya Sakalkirti",
                "Granths: Bhagwati Aradhana by Acharya Shivarya",
                "Granths: Shantinath Puran (Gujarati) by Acharya Sakalkirti",
                "Granths: Laghu Tattvasphot by Acharya Amritchandra",
                "Granths: Gnaanarnav by Acharya Shubhchandra",
                "Granths: Samyag Gyan Chandrika (Jeevkand) by Pandit Todarmal",
                "Pravachans: Bhaktamar Stotra and Rishabh Stotra",
                "Granths: Moksha Shastra by Acharya Umaswami",
                "Granths: Param Adhyatm Tarangini by Acharya Shubhchandra",
                "Granths: Samyag Gyan Chandrika (Karmkand, Labdhisaar, Kshapanasaar) by Pandit Todarmal",
                "Granths: Pravachansaar — Tattparyavratti (Tikakaar: Acharya Jaysen)",
                "Granths: Panchastikaya — Tattparyavratti (Tikakaar: Acharya Jaysen)",
                "Granths: Atmanushashan by Acharya Gunbhadra (Tikakaar: Pandit Todarmal)",
                "Granths: Pandav Puran (Gujarati) by Acharya Shubhchandra",
            ],
        },
        {
            date: "April 26, 2026",
            newContent: [
                "Granths: Dravya Drushti Prakash by Nihal Chandra Sogani",
                "Granths: Gurudevshri ke Vachanamrut by Shri Kanji Swami",
                "Granths: Tattvagyan Tarangini by Bhattarak Shri Gyanbhushan",
                "Granths: Updesh Siddhant Ratnamala by Shri Nemichand Bhandari",
                "Granths: Anagaar Dharmamrut and Sagaar Dharmamrut by Pandit Ashadhar",
                "Granths: Various Granths of Pandit Deepchand Kasliwal: Anubhav Prakash, Aatmavlokan, Chid Vilas, Anubhav Anand, Parmatma Puran, Savaiya Teeka and Bhav Deepika",
            ],
        },
        {
            date: "April 12, 2026",
            newFeatures: [
                "Search quality improvements: RRF hybrid search combining BM25 + semantic search",
                "Results now stream per category — first tab appears faster",
                "Text search toggle to force keyword search",
                "All category tabs shown immediately on search with loading indicators",
            ],
        },
        {
            date: "April 10, 2026",
            newContent: [
                "Granths: Harivansh Puran by Acharya Jinsen",
                "Pravachans: Chhah Dhala by Pandit Daulat Ram (50 Pravachans, Hindi)",
            ],
        },
        {
            date: "April 7, 2026",
            newContent: [
                "Granths: Sarvartha Siddhi, Jain Siddhant Darpan, Gyan Darpan and Moksh Marg Prakashak Parishisht",
            ],
        },
        {
            date: "April 3, 2026",
            newFeatures: [
                "Developer API! Build your own AI chatbots, RAG pipelines etc. using Swalakshya's data.",
                "UI refresh! More modern, compact, sharper fonts."
            ],
            newContent: [
                "Pravachan Series: Niyamsar 1975 series in Gujarati",
                "Pravachan Books: Dhanya Munidasha, Panchkalyanak Pravachan",
                "Granths: Aaradhansaar, Gyan Goshthi, Jambu Swami Charitra and Satta Swaroop",
            ],
        },
        {
            date: "March 16, 2026",
            newFeatures: [
                "Support for indexing multi-page PDFs — enables many more Granths.",
            ],
            newContent: [
                "Jain Siddhant Praveshika by Pandit Gopaldas ji Baraiya!",
            ],
        },
        {
            date: "March 11, 2026",
            newContent: [
                "New Granths added: Samaysaar Kalash Tika, Kartikeya Anupreksha and Padmanandi Panchvinchhati",
            ],
        },
        {
            date: "February 28, 2026",
            newFeatures: [
                "New automated way to parse and index scriptures to speed-up the indexing process",
            ],
            newContent: [
                "Total 11 new Granths added, including Panch Parmagams.",
                "Look at the Content page to see the list of available Granths",
            ],
        },
        {
            date: "January 15, 2026",
            newContent: [
                "Hindi Pravachans (compiled) on Mokshmarg Prakashak",
                "Total Indexed Pravachans: ~3200",
            ],
        },
        {
            date: "December 6, 2025",
            newFeatures: [
                "The user can now filter the Pravachan to a particular year to narrow down the search.",
                "The search results also show the date and pravachan number of a pravachan series, if available.",
            ],
        },
        {
            date: "November 7, 2025",
            newFeatures: [
                "Transliteration support! Users can now type in english letters to generate words in Hindi or Gujarati Scripts.",
            ],
        },
        {
            date: "October 5, 2025",
            newFeatures: [
                "NEW! Swalakshya now supports indexing of Mool Shastra as well!",
                "Chhah Dhala, Purusharth Siddhi Upay and Ishtopadesh are now searchable",
            ],
            newContent: [
                "Hindi Pravachans on Bahinshree Nu Vachanamrut",
                "Gujarati Pravachans on Pravachansar 1968-69 Series",
                "Total Indexed Pravachans: ~3700",
            ],
        },
        {
            date: "September 19, 2025",
            newFeatures: [
                "NEW! Support for Search Gujarati Pravachans is added!",
                "A new Content page is added that details all the searchable content that is available.",
            ],
            newContent: [
                "Gujarati Pravachans on Samaysar 1966 (15th time) Series",
                "Total Indexed Pravachans: ~3200",
            ],
        },
        {
            date: "September 7, 2025",
            newFeatures: [
                "Page load automatically focuses on search-box for ease of use",
                "Use \"/\" shortcut to focus on the search box",
            ],
            newContent: [
                "Pravachans on Padmanandi Panchvinchati 1960 Series",
                "Pravachans (compiled) on Kartikeya Anupreksha 1952 Series",
                "Pravachans on Niyamsaar 1971 Series",
                "Total Indexed Pravachans: ~2600",
            ],
        },
        {
            date: "August 29, 2025",
            newFeatures: [
                "\"Share icon\" to share Pravachan snippets",
                "Fixing pagination issues in semantic search",
                {
                    text: "Usage Guide: Tips to install hindi/gujarati keyboard",
                    link: "/usage-guide#typing-guide",
                    linkText: "View Guide"
                },
                "Minor UI improvements",
            ],
            newContent: [
                "Pravachans on Purusharth Siddhi Upay 1966 Series",
                "Pravachans on Natak Samaysaar 1971 Series",
                "Pravachans on Yogsaar 1966 Series",
                "Total Indexed Pravachans: ~2300",
            ],
        },
        {
            date: "August 24, 2025",
            newFeatures: [
                "\"Exclude Words\": Only show results which do not have these words",
                "Usage guide for new users",
                "Minor UI bug fixes",
            ],
            newContent: [
                "Pravachans on Parmatma Prakash 1976-77 Series",
                "Pravachans on Samaysar Kalash Tika 1977-78 Series",
                "Total Indexed Pravachans: ~2000",
            ],
        },
        {
            date: "August 17, 2025",
            newFeatures: [
                {
                    text: "Website Launched!",
                    link: "https://www.swalakshya.me/",
                    linkText: "https://www.swalakshya.me/"
                },
                "Directly open and view the original PDF file along with the search results.",
                "\"Did you mean?\": Spell Check functionality",
                "Similar document discovery functionality",
                "Numerous improvements in data quality",
            ],
            newContent: [
                "Pravachans on Panchastikaya 1969-70 Series",
                "Pravachans on Asht Pahud 1973-74 Series",
                "Total Indexed Pravachans: ~1500",
            ],
        },
        {
            date: "August 10, 2025",
            newFeatures: [
                "Full lexical/keyword search",
                "BETA: Full semantic search (question/answer)",
                "\"More Like This\": Look at similar documents",
            ],
            newContent: [
                "Pravachans on Samaysar 1978-80 Series",
                "Pravachans on Pravachansar 1979-80 Series",
                "Pravachans on Niyamsar 1979-80 Series",
                "Total Indexed Pravachans: ~1000",
            ],
        },
    ];

    return (
        <div className="max-w-4xl mx-auto">
            <PageHeader
                variant="hero"
                title="What's New?"
                subtitle="Stay updated with the latest improvements, new content, and features added to Swalakshya Chat."
            />

            <div className="space-y-8">
                {updates.map((update, index) => (
                    <Card key={index} className="overflow-hidden">
                        {/* Header with Date */}
                        <div
                            className="px-6 py-4"
                            style={{
                                backgroundColor: 'color-mix(in srgb, var(--color-brand) 8%, var(--color-surface))',
                                borderBottom: '1px solid color-mix(in srgb, var(--color-brand) 25%, transparent)',
                            }}
                        >
                            <h2 className="text-xl font-semibold" style={{ color: 'var(--color-brand)' }}>{update.date}</h2>
                        </div>

                        <div className="px-6 py-6">
                            <div className={`grid grid-cols-1 gap-8 ${update.newFeatures?.length > 0 && update.newContent?.length > 0 ? 'lg:grid-cols-2' : ''}`}>
                                {update.newFeatures?.length > 0 && (
                                    <div>
                                        <h3 className="text-lg font-semibold text-ink mb-4 flex items-center">
                                            <Zap size={18} className="mr-2" style={{ color: 'var(--color-info)' }} />
                                            New Features
                                        </h3>
                                        <ul className="space-y-2">
                                            {update.newFeatures.map((feature, featureIndex) => (
                                                <li key={featureIndex} className="flex items-start">
                                                    <span className="list-item-dot mt-2 mr-3" style={{ backgroundColor: 'var(--color-info)' }}></span>
                                                    {renderContent(feature)}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {update.newContent?.length > 0 && (
                                    <div>
                                        <h3 className="text-lg font-semibold text-ink mb-4 flex items-center">
                                            <FileText size={18} className="mr-2" style={{ color: 'var(--color-success)' }} />
                                            New Content
                                        </h3>
                                        <ul className="space-y-2">
                                            {update.newContent.map((item, itemIndex) => (
                                                <li key={itemIndex} className="flex items-start">
                                                    <span className="list-item-dot mt-2 mr-3" style={{ backgroundColor: 'var(--color-success)' }}></span>
                                                    {renderContent(item)}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Call to Action */}
            <div className="mt-12 text-center">
                <Card className="notice-brand p-8">
                    <h3 className="text-xl font-semibold text-ink mb-3">Have suggestions for new features?</h3>
                    <p className="text-ink-muted mb-4">
                        We're always looking to improve Swalakshya Chat based on your feedback and needs.
                    </p>
                    <Button onClick={() => window.location.href = '/feedback'}>
                        Share Your Feedback
                    </Button>
                </Card>
            </div>
        </div>
    );
};

export default WhatsNew;
