import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from './ui';
import { CATEGORY_EMOJI_SRC } from './chat/categoryEmoji';
import { useOverlayBehavior } from './ui/Modal';
import { OverlayBackdrop, CloseButton } from './ui/Overlay';

const TABS = [
    { category: 'Granth', key: '_granth_authors', label: 'Jain Acharyas & Gyanis' },
    { category: 'Books', key: '_books_authors', label: 'Contemporary Jain Scholars' },
];

export default function AuthorFilter({ authorGroups, authorsError, activeCategories, language, activeFilters, onAddFilter, onRemoveFilter }) {
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState('Granth');
    const [pending, setPending] = useState({});
    const [search, setSearch] = useState('');
    useOverlayBehavior(isOpen, () => setIsOpen(false));
    const current = TABS.find(item => item.category === tab);
    const selectedCount = Object.values(pending).reduce((total, names) => total + names.length, 0);
    const activeCount = activeFilters.filter(f => TABS.some(item => item.key === f.key)).length;
    const available = authorGroups?.[tab]?.[language];
    const filtered = (available || []).filter(name => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    const open = () => {
        setPending(Object.fromEntries(TABS.map(item => [item.key, activeFilters.filter(f => f.key === item.key).map(f => f.value)])));
        setTab(activeCategories.includes('Granth') ? 'Granth' : 'Books');
        setSearch('');
        setIsOpen(true);
    };
    const toggle = (name) => setPending(previous => {
        const names = previous[current.key] || [];
        return { ...previous, [current.key]: names.includes(name) ? names.filter(value => value !== name) : [...names, name] };
    });
    const apply = () => {
        activeFilters.map((f, index) => TABS.some(item => item.key === f.key) ? index : -1)
            .filter(index => index >= 0).reverse().forEach(onRemoveFilter);
        TABS.filter(item => activeCategories.includes(item.category)).forEach(item => {
            (pending[item.key] || []).forEach(value => onAddFilter({ key: item.key, value }));
        });
        setIsOpen(false);
    };
    return <>
        <button onClick={open} className={`filter-trigger flex-none ${activeCount ? 'filter-trigger-active' : ''}`}>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
                <img src={CATEGORY_EMOJI_SRC.Author} alt="" className="w-4 h-4 flex-shrink-0" />
                Author{activeCount ? ` (${activeCount})` : ''}
            </span><ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60" />
        </button>
        {isOpen && <OverlayBackdrop onClose={() => setIsOpen(false)} className="items-end md:items-center"
            contentClassName="filter-sheet rounded-t-lg md:rounded-lg md:max-w-lg md:max-h-[85vh]">
            <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="text-base font-bold text-ink">Filter by Author</h3>
                <CloseButton onClick={() => setIsOpen(false)} />
            </div>
            <div role="tablist" aria-label="Author categories" className="flex gap-2 px-4 pt-3">
                {TABS.map(item => <button key={item.category} role="tab" aria-selected={tab === item.category}
                    disabled={!activeCategories.includes(item.category)} onClick={() => { setTab(item.category); setSearch(''); }}
                    className={`flex-1 rounded-lg p-2 text-sm disabled:opacity-40 ${tab === item.category ? 'bg-brand text-white' : 'bg-surface text-ink'}`}>
                    {item.label}{pending[item.key]?.length ? ` (${pending[item.key].length})` : ''}
                </button>)}
            </div>
            <div className="px-4 pt-3 pb-2">
                <Input aria-label="Search authors" placeholder="Search authors..." value={search} onChange={event => setSearch(event.target.value)} />
                <p className="text-xs text-ink-muted mt-2">{tab === 'Granth' ? 'Authors of Granths' : 'Authors of contemporary Jain books'} · {language === 'gujarati' ? 'Gujarati' : 'Hindi'}</p>
            </div>
            <div role="tabpanel" aria-label={current.label} className="overflow-y-auto flex-1 px-4 pb-2">
                <div className="border border-border rounded-lg overflow-hidden">
                    {authorsError ? <p role="alert" className="p-4 text-sm text-ink-muted">Could not load authors. Please reload the page to retry.</p>
                        : !available ? <p className="p-4 text-sm text-ink-muted">Loading authors...</p>
                        : !filtered.length ? <p className="p-4 text-sm text-ink-muted">No authors found</p>
                        : filtered.map(name => <label key={name} className="filter-list-row">
                            <input type="checkbox" checked={(pending[current.key] || []).includes(name)} onChange={() => toggle(name)}
                                style={{ accentColor: 'var(--color-brand)' }} className="h-4 w-4 rounded" />
                            <span className="text-sm text-ink">{name}</span>
                        </label>)}
                </div>
            </div>
            <div className="p-4 border-t border-border flex justify-between gap-3">
                <button className="filter-trigger" onClick={() => { setPending({}); setSearch(''); }}>Clear</button>
                <button className="rounded-lg bg-brand text-white px-5 py-2 font-semibold" onClick={apply}>Apply{selectedCount ? ` (${selectedCount})` : ''}</button>
            </div>
        </OverlayBackdrop>}
    </>;
}
