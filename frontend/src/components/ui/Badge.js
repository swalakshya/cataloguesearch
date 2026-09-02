import React from 'react';

const VARIANT_CLASS = {
    brand: 'badge-brand',
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    info: 'badge-info',
    neutral: 'badge-neutral',
};

export default function Badge({ variant = 'neutral', className = '', children, ...props }) {
    return (
        <span className={`badge ${VARIANT_CLASS[variant] || VARIANT_CLASS.neutral} ${className}`} {...props}>
            {children}
        </span>
    );
}
