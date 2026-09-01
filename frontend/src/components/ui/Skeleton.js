import React from 'react';

export default function Skeleton({ className = '', ...props }) {
    return <div className={`skeleton ${className}`} {...props} />;
}
