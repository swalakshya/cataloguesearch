/**
 * Static content indexes for the /search-index page.
 *
 * Pravachan content is no longer listed here — it's fetched live from
 * GET /api/catalogue (see SearchIndex.js). Granth (Mool Shastra) and
 * Contemporary Jain Literature don't have a curated `count` per work, so
 * they stay as hand-maintained lists here until a similar catalogue exists
 * for those categories.
 */

/**
 * Searchable Granth / Mool Shastra Index. `anuyog` and `language` mirror the
 * real cataloguesearch-configs folder structure (Granth/<language>/<Anuyog>/<Name>).
 */
export const searchableGranths = [
  { name: "Aadi Puran", author: "Acharya Jinsen", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Aaradhansaar", author: "Acharya Devsen", tikakaar: "Pandit Ratnakeerti Dev", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Aatmavlokan", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Anagaar Dharmamrut", author: "Pandit Ashadhar", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Anubhav Anand", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Anubhav Prakash", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Asht Pahud", author: "Acharya Kund Kund", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Atmanushashan", author: "Acharya Gunbhadra", tikakaar: "Pandit Todarmal", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Bhagwan Hanuman", author: "Br. Harilal Jain", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Bhagwan Parshvanath", author: "Br. Harilal Jain", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Bhagwan Shantinath", author: "Br. Harilal Jain", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Bhagwati Aradhana", author: "Acharya Shivarya", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Bhartesh Vaibhav", author: "Mahakavi Ratnakar Varni", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Bhav Deepika", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Bruhad Dravya Sangrah", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Acharya Brahmadev", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Charcha Sangrah", author: "Pandit Raimall", anuyog: "Miscellaneous", language: "hi", status: "searchable" },
  { name: "Chid Vilas", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Chhah Dhala", author: "Pandit Shri Daulat Ram", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Dravya Drushti Prakash", author: "Nihal Chandra Sogani", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Gautam Charitra", author: "Mandalacharya Shri Dharmchandra", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Gnaanarnav", author: "Acharya Shubhchandra", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Gommatsaar Jeevkand", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Keshav Varni", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Gommatsaar Karmkand", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Keshav Varni", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Gurudevshri ke Vachanamrut", author: "Shri Kanji Swami", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Gyan Darpan", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Gyan Goshthi", author: "Shri Kanji Swami", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Harivansh Puran", author: "Acharya Jinsen", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Ishtopadesh", author: "Shrimad Pujyapad Swami", tikakaar: "Pandit Ashadhar", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Jain Siddhant Darpan", author: "Pandit Gopaldas Baraiyya", anuyog: "Miscellaneous", language: "hi", status: "searchable" },
  { name: "Jain Siddhant Praveshika", author: "Pandit Gopal Das Baraiya", anuyog: "Miscellaneous", language: "hi", status: "searchable" },
  { name: "Jambu Swami Charitra", author: "Pandit Rajmal Pandey", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Kartikeya Anupreksha", author: "Swami Kartikeya", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Laghu Tattvasphot", author: "Acharya Amritchandra", anuyog: "Others", language: "hi", status: "searchable" },
  { name: "Maharani Chelna", author: "Br. Harilal Jain", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Moksh Marg Prakashak", author: "Pandit Shri Todarmal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Moksh Marg Prakashak Parishisht", author: "Pandit Banarasidas", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Moksha Shastra", author: "Acharya Umaswami", tikakaar: "Shri Ramji Manekchand Doshi", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Niyamsaar", author: "Acharya Kund Kund", tikakaar: "Muni Padmaprabhmal Dhari Dev", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Padma Puran", author: "Acharya Ravisen", tikakaar: "Pandit Daulatram", anuyog: "Prathmanuyog", language: "gu", status: "searchable" },
  { name: "Padmanandi Panchvinchhati", author: "Acharya Padmanandi", tikakaar: "Pandit Gajadharlal Nyayateerth", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Panchastikaya", author: "Acharya Kund Kund", tikakaar: "Acharya Amritchandra", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Panchastikaya — Tattparyavratti", author: "Acharya Kund Kund", tikakaar: "Acharya Jaysen", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Pandav Puran", author: "Acharya Shubhchandra", anuyog: "Prathmanuyog", language: "gu", status: "searchable" },
  { name: "Param Adhyatm Tarangini", author: "Acharya Shubhchandra", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Parmatma Prakash", author: "Shrimad Yogindu Dev", tikakaar: "Shrimad Brahma Dev", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Parmatma Puran", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Pravachansaar", author: "Acharya Kund Kund", tikakaar: "Acharya Amritchandra", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Pravachansaar — Tattparyavratti", author: "Acharya Kund Kund", tikakaar: "Acharya Jaysen", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Purusharth Siddhi Upay", author: "Acharya Amritchandra", tikakaar: "Pandit Todarmal", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Ratnakarand Shravakachar", author: "Acharya Samant Bhadra", tikakaar: "Pandit Sadasukhdas Kasliwal", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Rayansaar", author: "Acharya Kund Kund", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Sagaar Dharmamrut", author: "Pandit Ashadhar", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Samadhi Tantra", author: "Shrimad Pujyapaad Swami", tikakaar: "Pandit Prabhachandra", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Samaysaar", author: "Acharya Kund Kund", tikakaar: "Acharya Amritchandra", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Samaysaar Kalash Tika", author: "Acharya Amritchandra", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Samyag Gyan Chandrika Jeevkand", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Todarmal", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Samyag Gyan Chandrika Karmkand", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Todarmal", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Samyag Gyan Chandrika Kshapanasaar", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Todarmal", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Samyag Gyan Chandrika Labdhisaar", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Todarmal", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Sarvartha Siddhi", author: "Pujyapaad Swami", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Satta Swaroop", author: "Pandit Bhagchandra Chhajed", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Savaiya Teeka", author: "Pandit Deepchand Kasliwal", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Shantinath Puran", author: "Acharya Sakalkirti", anuyog: "Prathmanuyog", language: "gu", status: "searchable" },
  { name: "Shrenik Charitra", author: "Bhattarak Shubhchandra", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Sukumal Charitra", author: "Acharya Sakalkirti", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Swanubhuti Darshan", author: "Bahinshree Champaben", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Tattvagyan Tarangini", author: "Bhattarak Shri Gyanbhushan", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Tattvanushashan", author: "Muni Nagsen", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Triloksaar", author: "Acharya Nemichand Siddhant Chakravarti", tikakaar: "Pandit Todarmal", anuyog: "Karananuyog", language: "hi", status: "searchable" },
  { name: "Updesh Siddhant Ratnamala", author: "Shri Nemichand Bhandari", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
  { name: "Uttar Puran", author: "Acharya Gunbhadra", anuyog: "Prathmanuyog", language: "hi", status: "searchable" },
  { name: "Varasanuvekkha", author: "Acharya Kund Kund", anuyog: "Charananuyog", language: "hi", status: "searchable" },
  { name: "Yogsaar", author: "Acharya Amitgati", anuyog: "Dravyanuyog", language: "hi", status: "searchable" },
];

/**
 * Get granth statistics
 */
export const getGranthStats = () => {
  const searchable = searchableGranths.filter(g => g.status === 'searchable').length;
  const inProgress = searchableGranths.filter(g => g.status === 'in_progress').length;
  const total = searchableGranths.length;

  return {
    searchable,
    inProgress,
    total
  };
};

/**
 * Contemporary Jain Literature — books by modern authors and scholars, distinct
 * from the canonical Granths above. All titles currently come from the Hindi
 * Books/ tree in cataloguesearch-configs.
 */
export const contemporaryLiterature = [
  { name: "Gunasthan Vivechan", author: "Br. Yashpal Jain", language: "hi", status: "searchable" },
  { name: "Anekant Syadvad", author: "Dr. Hukumdchand Bharill", language: "hi", status: "searchable" },
  { name: "Dharm ke Das Lakshan", author: "Dr. Hukumdchand Bharill", language: "hi", status: "searchable" },
  { name: "Krambaddh Paryay", author: "Dr. Hukumdchand Bharill", language: "hi", status: "searchable" },
  { name: "Naichakra", author: "Dr. Hukumdchand Bharill", language: "hi", status: "searchable" },
  { name: "Nimitt Upadan", author: "Dr. Hukumdchand Bharill", language: "hi", status: "searchable" },
  { name: "Shakahaar", author: "Dr. Hukumdchand Bharill", language: "hi", status: "searchable" },
  { name: "Jain Parva Charcha", author: "Dr. Praveen Jain", language: "hi", status: "searchable" },
  { name: "Bhed Vigyan", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Jeevan ka Aadhar — Samadhi", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Kaal Chakra", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Karmchakra se Siddhchakra", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Mokshmarg Sanjeevani", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Samudghat", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Teen Lok", author: "Dr. Sanjeev Godha", language: "hi", status: "searchable" },
  { name: "Acharya Kund Kund Dev", author: "—", language: "hi", status: "searchable" },
  { name: "Jain Shraman", author: "—", language: "hi", status: "searchable" },
  { name: "Jain Tattva Mimamsa", author: "—", language: "hi", status: "searchable" },
  { name: "Jin Poojan Rahasya", author: "Pandit Ratanchand Bharill", language: "hi", status: "searchable" },
  { name: "Namokaar Mahamantra", author: "Pandit Ratanchand Bharill", language: "hi", status: "searchable" },
  { name: "Shalaksha Purush", author: "Pandit Ratanchand Bharill", language: "hi", status: "searchable" },
];

/**
 * Get contemporary literature statistics
 */
export const getContemporaryLiteratureStats = () => {
  const searchable = contemporaryLiterature.filter(b => b.status === 'searchable').length;
  const total = contemporaryLiterature.length;

  return { searchable, total };
};
