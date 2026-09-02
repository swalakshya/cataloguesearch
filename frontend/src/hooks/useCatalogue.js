import { useState, useEffect } from 'react';
import { api } from '../services/api';

/**
 * Shared content catalogue (GET /api/catalogue), for any component that needs
 * the Pravachan series rows -- e.g. StatsStrip, SearchIndex.js.
 *
 * The actual network call is deduped/cached inside api.getCatalogue() itself
 * (30-minute TTL, shared across every caller), so mounting several components
 * that use this hook at once -- or navigating between pages that each render
 * one -- costs at most one request every 30 minutes, not one per mount.
 */
const useCatalogue = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        api.getCatalogue().then((data) => {
            if (!cancelled) {
                setRows(data);
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, []);

    return { rows, loading };
};

export default useCatalogue;
