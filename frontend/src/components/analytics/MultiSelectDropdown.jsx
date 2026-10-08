import React, { useEffect, useRef, useState } from 'react';

/**
 * A dropdown multi-select that shows selected items as inline badges.
 * Props:
 *   label       — shown when nothing selected, e.g. "All sources"
 *   options     — string[]
 *   selected    — string[]
 *   onChange    — (string[]) => void
 */
const MultiSelectDropdown = ({ label, options, selected, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const toggle = (val) => {
        onChange(
            selected.includes(val)
                ? selected.filter(s => s !== val)
                : [...selected, val]
        );
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex min-w-[120px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm hover:bg-slate-50 focus:outline-none"
            >
                {selected.length === 0 ? (
                    <span className="text-slate-400 text-xs">{label}</span>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {selected.map(s => (
                            <span key={s} className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                                {s}
                            </span>
                        ))}
                    </div>
                )}
                <span className="ml-auto pl-1 text-slate-400 text-xs">▾</span>
            </button>

            {open && (
                <div className="absolute left-0 z-20 mt-1 min-w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {options.map(opt => (
                        <label
                            key={opt}
                            className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-slate-50"
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(opt)}
                                onChange={() => toggle(opt)}
                                className="h-3.5 w-3.5 rounded border-slate-300 accent-sky-600"
                            />
                            <span className="text-xs text-slate-700">{opt}</span>
                        </label>
                    ))}
                    <div className="my-1 border-t border-slate-100" />
                    <button
                        type="button"
                        onClick={() => { onChange([...options]); setOpen(false); }}
                        className="w-full px-3 py-1.5 text-left text-xs text-slate-500 hover:text-slate-700"
                    >
                        Select all
                    </button>
                    {selected.length > 0 && (
                        <button
                            type="button"
                            onClick={() => { onChange([]); setOpen(false); }}
                            className="w-full px-3 py-1.5 text-left text-xs text-slate-400 hover:text-slate-600"
                        >
                            Clear all
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default MultiSelectDropdown;
