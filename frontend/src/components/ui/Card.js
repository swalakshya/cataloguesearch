import React from 'react';

export default function Card({ className = '', children, ...props }) {
    return (
        <div className={`card ${className}`} {...props}>
            {children}
        </div>
    );
}
