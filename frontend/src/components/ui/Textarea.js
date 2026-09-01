import React from 'react';

export default function Textarea({ error, className = '', ...props }) {
    return <textarea className={`field ${error ? 'field-error' : ''} ${className}`} {...props} />;
}
