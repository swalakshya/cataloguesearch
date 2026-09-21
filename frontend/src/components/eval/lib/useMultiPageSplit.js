import { useState, useEffect } from 'react';

/**
 * Hook for multi-page PDF split functionality.
 * Manages state, canvas-based image splitting, and split preview generation.
 * Used by OCRUtils and ScriptureLLMEval.
 */
const useMultiPageSplit = ({ previewUrl, croppedPreviewUrl }) => {
    const [multiPagePDF, setMultiPagePDF] = useState(false);
    const [splitPct, setSplitPct] = useState(50);
    const [splitPreviewUrls, setSplitPreviewUrls] = useState(null);

    // Returns { left: dataUrl, right: dataUrl } for preview display
    const splitImageDataUrl = (dataUrl, pct) =>
        new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const { width, height } = img;
                const sx = Math.floor(width * pct / 100);
                const makeHalf = (x, w) => {
                    const c = document.createElement('canvas');
                    c.width = w;
                    c.height = height;
                    c.getContext('2d').drawImage(img, x, 0, w, height, 0, 0, w, height);
                    return c.toDataURL('image/png');
                };
                resolve({ left: makeHalf(0, sx), right: makeHalf(sx, width - sx) });
            };
            img.src = dataUrl;
        });

    // Returns a File object for one half — used for API calls
    const splitImageFile = (file, pct, side) =>
        new Promise((resolve) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const { width, height } = img;
                const sx = Math.floor(width * pct / 100);
                const [x, w] = side === 'left' ? [0, sx] : [sx, width - sx];
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, x, 0, w, height, 0, 0, w, height);
                URL.revokeObjectURL(url);
                canvas.toBlob(
                    (blob) => resolve(new File([blob], `${side}_half.png`, { type: 'image/png' })),
                    'image/png'
                );
            };
            img.src = url;
        });

    // Recompute split previews whenever relevant inputs change
    useEffect(() => {
        if (multiPagePDF && previewUrl) {
            splitImageDataUrl(croppedPreviewUrl || previewUrl, splitPct).then(setSplitPreviewUrls);
        } else {
            setSplitPreviewUrls(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [multiPagePDF, previewUrl, croppedPreviewUrl, splitPct]);

    return {
        multiPagePDF, setMultiPagePDF,
        splitPct, setSplitPct,
        splitPreviewUrls,
        splitImageFile,
    };
};

export default useMultiPageSplit;
