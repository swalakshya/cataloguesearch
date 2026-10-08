import React from 'react';

export default function Input({ error, className = '', ...props }) {
    return <input className={`field ${error ? 'field-error' : ''} ${className}`} {...props} />;
}
