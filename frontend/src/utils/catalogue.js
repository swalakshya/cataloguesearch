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
