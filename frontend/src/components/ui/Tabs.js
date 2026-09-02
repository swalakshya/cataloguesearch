import React from 'react';

// tabs: [{ key, label, icon?: LucideComponent, count?: number }]
export default function Tabs({ tabs, activeKey, onChange, className = '' }) {
    return (
        <div className={`flex gap-4 border-b border-border ${className}`}>
            {tabs.map((tab) => {
                const active = tab.key === activeKey;
                const Icon = tab.icon;
                return (
                    <button
                        key={tab.key}
                        onClick={() => onChange(tab.key)}
                        className="flex items-center gap-1.5 pb-2 text-sm font-medium"
                        style={{
                            borderBottom: active ? '2px solid var(--color-brand)' : '2px solid transparent',
                            color: active ? 'var(--color-brand)' : 'var(--color-ink-muted)',
                        }}
                    >
                        {Icon && <Icon size={15} />}
                        {tab.label}
                        {typeof tab.count === 'number' && (
                            <span className="badge badge-neutral" style={{ marginLeft: 2 }}>{tab.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
