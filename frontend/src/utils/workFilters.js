// Keep the metadata universe separate from the titles offered by the picker.
export function eligibleWorkNames(allNames, rows, language, authors, category) {
    if (!authors.length) return allNames;
    const languageKey = { hindi: 'hi', gujarati: 'gu' }[language] || language;
    const selected = new Set(authors);
    const titles = new Set(rows.filter(row => {
        const rowAuthors = Array.isArray(row.author) ? row.author : [row.author];
        return row.category === category && row.language === languageKey
            && rowAuthors.some(author => selected.has(author));
    }).map(row => row.granth));
    return allNames.filter(name => titles.has(name));
}

export function applyAuthorFilters(filters, authors, allWorkNames, eligibleNames) {
    const workNames = new Set(allWorkNames);
    const eligible = new Set(eligibleNames);
    return [...filters.filter(filter =>
        !['_books_authors', '_granth_authors', '_magazine_authors'].includes(filter.key)
        && !(filter.key === 'Name' && workNames.has(filter.value) && !eligible.has(filter.value))
    ), ...authors];
}
