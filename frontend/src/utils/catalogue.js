// Language editions of the same work share one Granth; distinct contributors
// or commentaries remain separate. Used by both the index table and stats.
export function groupGranthEditions(rows) {
    const groups = new Map();
    rows.forEach((row) => {
        const key = JSON.stringify([row.granth, row.author || '', row.tikakaar || '', row.anuyog || '']);
        if (!groups.has(key)) groups.set(key, { ...row, key, hi: false, gu: false });
        const group = groups.get(key);
        if (row.language === 'hi') group.hi = true;
        else if (row.language === 'gu') group.gu = true;
    });
    return Array.from(groups.values());
}

// The catalogue includes configured magazines before OCR/indexing finishes.
// Keep their picker available without implying their pages are searchable yet.
export function mergeMagazineMetadata(metadata, rows) {
    const magazines = (rows || []).filter(row => row.category === 'Magazine');
    if (!magazines.length) return metadata;
    const editions = { ...metadata.Magazine };
    for (const [code, language] of [['hi', 'hindi'], ['gu', 'gujarati']]) {
        const current = editions[language] || {};
        editions[language] = { ...current, Name: [...new Set([
            ...(current.Name || []), ...magazines.filter(row => row.language === code).map(row => row.granth),
        ])].sort() };
    }
    return { ...metadata, Magazine: editions };
}

export function groupMagazineEditions(rows) {
    const magazines = new Map();
    for (const row of rows) {
        if (!magazines.has(row.granth)) magazines.set(row.granth,
            { key: row.granth, granth: row.granth, hi: false, gu: false, issue_count: 0 });
        const magazine = magazines.get(row.granth);
        if (row.language === 'hi') magazine.hi = true;
        if (row.language === 'gu') magazine.gu = true;
        magazine.issue_count += Number(row.issue_count) || 0;
    }
    return [...magazines.values()];
}
