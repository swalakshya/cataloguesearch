import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import useCatalogue from '../hooks/useCatalogue';
import { searchableGranths, contemporaryLiterature } from '../utils/searchableContent.js';
import { PageHeader, Table, Badge } from './ui';
import StatsStrip from './chat/StatsStrip';
import { CategoryEmojiIcon } from './chat/categoryEmoji';

// Static per this session, computed once at module scope rather than on
// every render (unlike the Pravachan Granth list, which depends on the
// fetched catalogue and so has to be a useMemo inside the component).
const GRANTH_AUTHOR_OPTIONS = [...new Set(searchableGranths.map((g) => g.author))].sort();
const GRANTH_ANUYOG_OPTIONS = [...new Set(searchableGranths.map((g) => g.anuyog))].sort();
const BOOKS_AUTHOR_OPTIONS = [...new Set(contemporaryLiterature.map((b) => b.author))].sort();

// Rows must already be sorted by `key`. Annotates each row with `_span`: the
// rowSpan for the first row of a group, 0 for the rest of the group (meaning
// "part of a merge above me, omit this <td>"). This is the Excel-style
// merged-cell rendering for a Granth that spans multiple series/rows.
const withRowSpans = (rows, key) => {
  const out = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && rows[j][key] === rows[i][key]) j++;
    for (let k = i; k < j; k++) out.push({ ...rows[k], _span: k === i ? j - i : 0 });
    i = j;
  }
  return out;
};

const renderCount = (count) => {
  // Plain text throughout -- a count is a value, not a state, so it never
  // gets a badge/pill treatment. "compiled" is the one non-numeric value.
  if (count === 'compiled') return <span className="text-ink-muted">Compiled</span>;
  const n = parseInt(count, 10);
  return <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{Number.isNaN(n) ? count : n.toLocaleString()}</span>;
};

// A tick echoes the colored icon-chip language used by StatsStrip elsewhere
// in the app, rather than a bare glyph -- consistent with the rest of the UI.
const AvailabilityMark = ({ available }) => (
  available ? (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 16%, var(--color-surface))' }}
    >
      <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />
    </span>
  ) : <span className="text-ink-muted">-</span>
);

const AnuyogBadge = ({ anuyog }) => anuyog ? <Badge variant="neutral">{anuyog}</Badge> : <span className="text-ink-muted">-</span>;

// Same colored icon-chip + title treatment StatsStrip uses per category, so a
// section reads as part of the same system instead of a plain <h2>.
const SectionHeader = ({ category, colorVar, title }) => (
  <div className="flex items-center gap-2.5 mb-4">
    <div
      className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
      style={{ backgroundColor: `color-mix(in srgb, var(${colorVar}) 14%, var(--color-surface))` }}
    >
      <CategoryEmojiIcon category={category} size={18} />
    </div>
    <h2 className="text-2xl font-bold text-ink">{title}</h2>
  </div>
);

// Two independently-toggleable, script-native language buttons -- replaces a
// three-button All/Hindi/Gujarati row (the English "Gujarati" label was
// overflowing its button on narrow widths).
//
// .filter-trigger is `flex: 1 1 0%; min-width: 0` by design (see components.css)
// -- it's meant to stretch to fill a Refine Search row of several triggers,
// and every existing usage wraps its label in a `whitespace-nowrap` span so
// the shrink never wraps the text. These two buttons aren't meant to stretch
// at all, so `flex-none` cancels that and `whitespace-nowrap` matches the
// same safeguard the other usages already have.
const LanguageToggle = ({ hiOn, guOn, onToggleHi, onToggleGu }) => (
  <div className="flex gap-1.5">
    <button className={`filter-trigger flex-none whitespace-nowrap ${hiOn ? 'filter-trigger-active' : ''}`} onClick={onToggleHi}>हिन्दी</button>
    <button className={`filter-trigger flex-none whitespace-nowrap ${guOn ? 'filter-trigger-active' : ''}`} onClick={onToggleGu}>ગુજરાતી</button>
  </div>
);

// Checkbox-list dropdown for picking any number of values at once -- shared
// by the Pravachan Granth filter and the Granth/Books Author & Anuyog filters.
const MultiSelectFilter = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const allSelected = options.length > 0 && selected.size === options.length;
  const toggleOne = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  const toggleAll = () => onChange(allSelected ? new Set() : new Set(options));

  const summary = allSelected
    ? `All ${label}s`
    : selected.size === 0
      ? `No ${label}s`
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} ${label}s`;

  return (
    <div className="relative" ref={ref}>
      <button
        className={`filter-trigger flex-none ${!allSelected ? 'filter-trigger-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="whitespace-nowrap truncate" style={{ maxWidth: 160 }}>{summary}</span>
        <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60 shrink-0" />
      </button>
      {open && (
        <div className="card absolute z-10 mt-1 overflow-y-auto" style={{ width: 260, maxHeight: 320 }}>
          <label className="filter-list-row">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span className="font-semibold">Select All</span>
          </label>
          {options.map((name) => (
            <label key={name} className="filter-list-row">
              <input type="checkbox" checked={selected.has(name)} onChange={() => toggleOne(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const SearchIndex = () => {
  const location = useLocation();
  // Shares its underlying fetch/cache with every other caller (e.g. StatsStrip)
  // -- see hooks/useCatalogue.js.
  const { rows: catalogue, loading } = useCatalogue();

  // Jumps to the section named by the URL hash -- lands here either via a
  // full navigation from another page (e.g. a StatsStrip tile) or a same-page
  // hash change, since react-router's <Link> doesn't trigger the browser's
  // native fragment scroll on its own.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const [selectedGranths, setSelectedGranths] = useState(new Set());
  const [hiOn, setHiOn] = useState(true);
  const [guOn, setGuOn] = useState(true);

  const [selectedGranthAuthors, setSelectedGranthAuthors] = useState(new Set(GRANTH_AUTHOR_OPTIONS));
  const [selectedGranthAnuyogs, setSelectedGranthAnuyogs] = useState(new Set(GRANTH_ANUYOG_OPTIONS));
  const [granthHiOn, setGranthHiOn] = useState(true);
  const [granthGuOn, setGranthGuOn] = useState(true);

  const [selectedBookAuthors, setSelectedBookAuthors] = useState(new Set(BOOKS_AUTHOR_OPTIONS));

  // Defaults the Granth filter to "everything" the first time the catalogue
  // actually arrives -- loading only flips true -> false once per mount, so
  // this fires exactly once (not on every re-render the cache causes elsewhere).
  useEffect(() => {
    if (!loading) setSelectedGranths(new Set(catalogue.map((r) => r.granth)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const granthOptions = useMemo(
    () => [...new Set(catalogue.map((r) => r.granth))].sort(),
    [catalogue]
  );

  // One row per (Granth, Series) -- a series recorded in both languages (rare;
  // it only happens when the series label coincides, e.g. Niyamsaar's "1975
  // Series") collapses into a single row with both columns ticked. Otherwise a
  // series shows a tick in exactly one language column, "-" in the other.
  const groupedPravachan = useMemo(() => {
    const map = new Map();
    catalogue.forEach((r) => {
      const key = `${r.granth}::${r.series || ''}`;
      if (!map.has(key)) {
        map.set(key, { granth: r.granth, series: r.series, anuyog: r.anuyog, count: r.count, hi: false, gu: false });
      }
      const group = map.get(key);
      if (r.language === 'hi') group.hi = true;
      else if (r.language === 'gu') group.gu = true;
      if (!group.anuyog) group.anuyog = r.anuyog;
    });
    return Array.from(map.values());
  }, [catalogue]);

  const filteredPravachan = useMemo(() => {
    return groupedPravachan
      .filter((g) => selectedGranths.has(g.granth))
      .filter((g) => (hiOn && g.hi) || (guOn && g.gu))
      .sort((a, b) => a.granth.localeCompare(b.granth) || (a.series || '').localeCompare(b.series || ''));
  }, [groupedPravachan, selectedGranths, hiOn, guOn]);

  const mergedPravachan = useMemo(() => withRowSpans(filteredPravachan, 'granth'), [filteredPravachan]);

  const filteredTotals = useMemo(() => {
    const flatFiltered = catalogue.filter((r) => selectedGranths.has(r.granth));
    const sum = (lang, on) => on ? flatFiltered
      .filter((r) => r.language === lang && r.count !== 'compiled')
      .reduce((acc, r) => acc + (parseInt(r.count, 10) || 0), 0) : 0;
    return { hindi: sum('hi', hiOn), gujarati: sum('gu', guOn) };
  }, [catalogue, selectedGranths, hiOn, guOn]);

  const filteredGranths = useMemo(() => searchableGranths
    .filter((g) => selectedGranthAuthors.has(g.author))
    .filter((g) => selectedGranthAnuyogs.has(g.anuyog))
    .filter((g) => (granthHiOn && g.language === 'hi') || (granthGuOn && g.language === 'gu')),
    [selectedGranthAuthors, selectedGranthAnuyogs, granthHiOn, granthGuOn]);

  const filteredBooks = useMemo(() => contemporaryLiterature
    .filter((b) => selectedBookAuthors.has(b.author)),
    [selectedBookAuthors]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-10">
      <PageHeader
        variant="hero"
        title="Swalakshya Index"
        subtitle={(
          <>
            Index of Jain Scriptures, Gurudevshri's Pravachan Series and contemporary literature
            available in Swalakshya. Looking for something? Share us a{' '}
            <Link to="/feedback" className="text-brand underline decoration-brand underline-offset-2 hover:text-brand-hover transition-colors">
              feedback
            </Link>!
          </>
        )}
      />

      <div className="mb-12">
        <StatsStrip />
      </div>

      {/* ===================== Pravachan Index ===================== */}
      <section id="pravachan-index" className="mb-14 scroll-mt-24">
        <SectionHeader category="Pravachan" colorVar="--color-info" title="Pravachan Index" />

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <MultiSelectFilter label="Granth" options={granthOptions} selected={selectedGranths} onChange={setSelectedGranths} />
          <LanguageToggle hiOn={hiOn} guOn={guOn} onToggleHi={() => setHiOn((v) => !v)} onToggleGu={() => setGuOn((v) => !v)} />
        </div>

        {loading ? (
          <p className="text-ink-muted text-sm">Loading catalogue…</p>
        ) : (
          <>
            <Table
              columns={[
                { key: 'granth', label: 'Granth' },
                { key: 'series', label: 'Series' },
                { key: 'anuyog', label: 'Anuyog' },
                { key: 'count', label: 'Count' },
                { key: 'hi', label: 'Hindi' },
                { key: 'gu', label: 'Gujarati' },
              ]}
              rows={mergedPravachan}
              rowKey={(row) => `${row.granth}::${row.series || ''}`}
              renderRow={(row) => (
                <>
                  {row._span > 0 && (
                    <td
                      rowSpan={row._span}
                      className="font-semibold text-ink align-middle"
                      style={{
                        borderRight: '1px solid var(--color-border)',
                        backgroundColor: 'color-mix(in srgb, var(--color-brand) 4%, var(--color-surface))',
                      }}
                    >
                      {row.granth}
                    </td>
                  )}
                  <td>{row.series || '-'}</td>
                  <td><AnuyogBadge anuyog={row.anuyog} /></td>
                  <td>{renderCount(row.count)}</td>
                  <td className="text-center"><AvailabilityMark available={row.hi} /></td>
                  <td className="text-center"><AvailabilityMark available={row.gu} /></td>
                </>
              )}
            />
            {mergedPravachan.length === 0 && (
              <p className="text-center text-ink-muted text-sm py-6">No series match this filter.</p>
            )}
            <p className="text-xs text-ink-muted mt-2">
              Showing {filteredPravachan.length} of {groupedPravachan.length} series · हिन्दी {filteredTotals.hindi.toLocaleString()} · ગુજરાતી {filteredTotals.gujarati.toLocaleString()}
            </p>
          </>
        )}
      </section>

      {/* ===================== Granth / Mool Shastra ===================== */}
      <section id="granth-index" className="mb-14 scroll-mt-24">
        <SectionHeader category="Granth" colorVar="--color-brand" title="Granth / Mool Shastra" />

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <MultiSelectFilter label="Author" options={GRANTH_AUTHOR_OPTIONS} selected={selectedGranthAuthors} onChange={setSelectedGranthAuthors} />
          <MultiSelectFilter label="Anuyog" options={GRANTH_ANUYOG_OPTIONS} selected={selectedGranthAnuyogs} onChange={setSelectedGranthAnuyogs} />
          <LanguageToggle hiOn={granthHiOn} guOn={granthGuOn} onToggleHi={() => setGranthHiOn((v) => !v)} onToggleGu={() => setGranthGuOn((v) => !v)} />
        </div>

        <Table
          columns={[
            { key: 'name', label: 'Granth' },
            { key: 'author', label: 'Author' },
            { key: 'tikakaar', label: 'Tikakaar / Bhasha Vachanika' },
            { key: 'anuyog', label: 'Anuyog' },
          ]}
          rows={filteredGranths}
          rowKey={(row) => row.name}
          renderRow={(row) => (
            <>
              <td className="font-medium text-ink">{row.name}</td>
              <td className="text-ink-muted">{row.author}</td>
              <td className="text-ink-muted">{row.tikakaar || '-'}</td>
              <td><AnuyogBadge anuyog={row.anuyog} /></td>
            </>
          )}
        />
        {filteredGranths.length === 0 && (
          <p className="text-center text-ink-muted text-sm py-6">No Granths match this filter.</p>
        )}
      </section>

      {/* ===================== Contemporary Jain Literature ===================== */}
      <section id="contemporary-index" className="scroll-mt-24">
        <SectionHeader category="Curated" colorVar="--color-danger" title="Contemporary Jain Literature" />

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <MultiSelectFilter label="Author" options={BOOKS_AUTHOR_OPTIONS} selected={selectedBookAuthors} onChange={setSelectedBookAuthors} />
        </div>

        <Table
          columns={[
            { key: 'name', label: 'Title' },
            { key: 'author', label: 'Author' },
            { key: 'language', label: 'Language' },
          ]}
          rows={filteredBooks}
          rowKey={(row) => row.name}
          renderRow={(row) => (
            <>
              <td className="font-medium text-ink">{row.name}</td>
              <td className="text-ink-muted">{row.author}</td>
              <td className="text-ink-muted">{row.language === 'hi' ? 'Hindi' : 'Gujarati'}</td>
            </>
          )}
        />
        {filteredBooks.length === 0 && (
          <p className="text-center text-ink-muted text-sm py-6">No titles match this filter.</p>
        )}
      </section>
    </div>
  );
};

export default SearchIndex;
