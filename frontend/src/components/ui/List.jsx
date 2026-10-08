import React from 'react';

export function List({ className = '', children, ...props }) {
    return (
        <div className={`list ${className}`} {...props}>
            {children}
        </div>
    );
}

export function ListItem({ className = '', children, ...props }) {
    return (
        <div className={`list-item ${className}`} {...props}>
            <span className="list-item-dot" />
            <span>{children}</span>
        </div>
    );
}
