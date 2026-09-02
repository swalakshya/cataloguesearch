import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Generic sortable-table shell.
// columns: [{ key, label, sortable? }]
// rows: array of row data
// sortConfig: { key, direction: 'asc'|'desc' } | null
// onSort(key), rowKey(row), renderRow(row) => <>...<td>...</td></>
export default function Table({ columns, rows, sortConfig, onSort, rowKey, renderRow, className = '' }) {
    return (
        <div className={`table-wrap ${className}`}>
            <table className="data-table">
                <thead>
                    <tr>
                        {columns.map((col) => {
                            const isSorted = sortConfig?.key === col.key;
                            return (
                                <th
                                    key={col.key}
                                    className={col.sortable ? 'sortable' : ''}
                                    onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                                >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        {col.label}
                                        {col.sortable && isSorted && (
                                            sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                        )}
                                    </span>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={rowKey(row)}>{renderRow(row)}</tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
