/**
 * Searchable Content Index
 *
 * This file maintains a list of all pravachans and content available for search.
 * Update this file as new content is indexed and made searchable.
 */

export const searchableContent = [
  {
    granth: "Samaysaar",
    series: "1978-80 (19th time)",
    count: 536,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Pravachansaar",
    series: "1979-80",
    count: 287,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Niyamsaar",
    series: "1979-80",
    count: 214,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Niyamsaar",
    series: "1971",
    count: 202,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Niyamsaar",
    series: "1975-76",
    count: 183,
    hindi: null,
    gujarati: "searchable"
  },
  {
    granth: "Panchastikaya",
    series: "1970",
    count: 88,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Asht Pahud",
    series: "1970-71",
    count: 195,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Samaysaar Kalash Tika",
    series: "1977-78",
    count: 308,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Parmatma Prakash",
    series: "1976-77",
    count: 245,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Samadhi Tantra",
    series: "1974",
    count: 110,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Purusharth Siddhi Upay",
    series: "1966",
    count: 89,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Padmanandi Panchvinshati",
    series: "1960",
    count: 69,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Natak Samaysaar",
    series: "1971-72",
    count: 197,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Ishtopadesh",
    series: "1966",
    count: 55,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Yogsaar",
    series: "1966",
    count: 45,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Kartikeya Anupreksha",
    series: "1952",
    count: null,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Bahinshree Nu Vachanamrut",
    series: 1978,
    count: 181,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Pravachan Navneet",
    series: 1977,
    count: 142,
    hindi: "in_progress",
    gujarati: null
  },
  {
    granth: "Samaysaar",
    series: "1966-68 (15th time)",
    count: 595,
    hindi: null,
    gujarati: "searchable"
  },
  {
    granth: "Pravachansaar",
    series: "1968-69",
    count: 280,
    hindi: null,
    gujarati: "searchable"
  },
  {
    granth: "Samaysaar",
    series: "1975 (18th time)",
    count: 535,
    hindi: null,
    gujarati: "searchable"
  },
  {
    granth: "Mokshmarg Prakashak",
    series: "1952 Series",
    count: null,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Bruhad Dravya Sangrah",
    count: null,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Mool ma Bhool",
    count: null,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Dhanya Munidasha",
    count: null,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Panchkalyanak Pravachan",
    count: null,
    hindi: "searchable",
    gujarati: null
  },
  {
    granth: "Chhah Dhala",
    count: 50,
    hindi: "searchable",
    gujarati: null
  }
];

/**
 * Get searchable content statistics
 */
export const getSearchableStats = () => {
  const hindiSearchable = searchableContent.filter(item => item.hindi === 'searchable');
  const gujaratiSearchable = searchableContent.filter(item => item.gujarati === 'searchable');

  const hindiTotal = hindiSearchable.reduce((sum, item) => sum + (item.count || 0), 0);
  const gujaratiTotal = gujaratiSearchable.reduce((sum, item) => sum + (item.count || 0), 0);

  const hindiSeries = hindiSearchable.length;
  const gujaratiSeries = gujaratiSearchable.length;

  return {
    hindiTotal,
    gujaratiTotal,
    hindiSeries,
    gujaratiSeries,
    grandTotal: hindiTotal + gujaratiTotal
  };
};

/**
 * Get content by status
 */
export const getContentByStatus = (status = 'searchable') => {
  return {
    hindi: searchableContent.filter(item => item.hindi === status),
    gujarati: searchableContent.filter(item => item.gujarati === status)
  };
};

/**
 * Get all unique granths
 */
export const getAllGranths = () => {
  const granths = searchableContent.map(item => item.granth);
  return [...new Set(granths)];
};

/**
 * Searchable Granth/Mool Shastra Index
 */
export const searchableGranths = [
  {
    name: "Samaysaar",
    author: "Acharya Kund Kund",
    status: "searchable"
  },
  {
    name: "Pravachansaar",
    author: "Acharya Kund Kund",
    status: "searchable"
  },
  {
    name: "Niyamsaar",
    author: "Acharya Kund Kund",
    status: "searchable"
  },
  {
    name: "Panchastikaya",
    author: "Acharya Kund Kund",
    status: "searchable"
  },
  {
    name: "Asht Pahud",
    author: "Acharya Kund Kund",
    status: "searchable"
  },
  {
    name: "Purusharth Siddhi Upay",
    author: "Acharya Amritchandra",
    status: "searchable"
  },
  {
    name: "Ishtopadesh",
    author: "Shrimad Pujyapad Swami",
    status: "searchable"
  },
  {
    name: "Bruhad Dravya Sangrah",
    author: "Acharya Nemichand Siddhant Chakravarti",
    status: "searchable"
  },
  {
    name: "Ratnakarand Shravakachar",
    author: "Acharya Samant Bhadra",
    status: "searchable"
  },
  {
    name: "Moksh Marg Prakashak",
    author: "Pandit Shri Todarmal",
    status: "searchable"
  },
  {
    name: "Chhah Dhala",
    author: "Pandit Shri Daulat Ram",
    status: "searchable"
  },
  {
    name: "Parmatma Prakash",
    author: "Shrimad Yogindu Dev",
    status: "searchable"
  },
  {
    name: "Samadhi Tantra",
    author: "Shrimad Pujyapaad Swami",
    status: "searchable"
  },
  {
    name: "Padmanandi Panchvinchhati",
    author: "Acharya Padmanandi",
    status: "searchable"
  },
  {
    name: "Kartikeya Anupreksha",
    author: "Swami Kartikeya",
    status: "searchable"
  },
  {
    name: "Samaysaar Kalash Tika",
    author: "Acharya Amritchandra",
    status: "searchable"
  },
  {
    name: "Jain Siddhant Praveshika",
    author: "Pandit Gopal Das Baraiya",
    status: "searchable"
  },
  {
    name: "Satta Swaroop",
    author: "Pandit Bhagchandra Chhajed",
    status: "searchable"
  },
  {
    name: "Jambu Swami Charitra",
    author: "Pandit Rajmal Pandey",
    status: "searchable"
  },
  {
    name: "Aaradhansaar",
    author: "Acharya Devsen",
    status: "searchable"
  },
  {
    name: "Gyan Goshthi",
    author: "Shri Kanji Swami",
    status: "searchable"
  },
  {
    name: "Sarvartha Siddhi",
    author: "Pujyapaad Swami",
    status: "searchable"
  },
  {
    name: "Jain Siddhant Darpan",
    author: "Pandit Gopaldas Baraiyya",
    status: "searchable"
  },
  {
    name: "Gyan Darpan",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Moksh Marg Prakashak Parishisht",
    author: "Pandit Banarasidas",
    status: "searchable"
  },
  {
    name: "Harivansh Puran",
    author: "Acharya Jinsen",
    status: "searchable"
  },
  {
    name: "Dravya Drushti Prakash",
    author: "Nihal Chandra Sogani",
    status: "searchable"
  },
  {
    name: "Gurudevshri ke Vachanamrut",
    author: "Shri Kanji Swami",
    status: "searchable"
  },
  {
    name: "Tattvagyan Tarangini",
    author: "Bhattarak Shri Gyanbhushan",
    status: "searchable"
  },
  {
    name: "Updesh Siddhant Ratnamala",
    author: "Shri Nemichand Bhandari",
    status: "searchable"
  },
  {
    name: "Anagaar Dharmamrut",
    author: "Pandit Ashadhar",
    status: "searchable"
  },
  {
    name: "Sagaar Dharmamrut",
    author: "Pandit Ashadhar",
    status: "searchable"
  },
  {
    name: "Anubhav Prakash",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Aatmavlokan",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Chid Vilas",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Anubhav Anand",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Parmatma Puran",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Savaiya Teeka",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Bhav Deepika",
    author: "Pandit Deepchand Kasliwal",
    status: "searchable"
  },
  {
    name: "Yogsaar",
    author: "Acharya Amitgati",
    status: "searchable"
  },
  {
    name: "Varasanuvekkha",
    author: "Acharya Kund Kund",
    status: "searchable"
  },
  {
    name: "Charcha Sangrah",
    author: "Pandit Raimall"
  }
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
 * Get combined statistics for Pravachan and Granth
 */
export const getAllStats = () => {
  const pravachanStats = getSearchableStats();
  const granthStats = getGranthStats();

  return {
    pravachan: pravachanStats,
    granth: granthStats
  };
};