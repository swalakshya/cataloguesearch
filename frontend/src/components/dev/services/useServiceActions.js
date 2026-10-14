import { useState } from 'react';
import { postJson } from '../JobUI';

export default function useServiceActions(jobs, refresh) {
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');
    const perform = async (service, action) => {
        if (action.confirmation && !window.confirm(action.confirmation)) return;
        setStarting(true);
        setError('');
        try {
            const { run_id } = await postJson('/local-services/actions', {
                service, action: action.id, confirm: Boolean(action.confirmation),
            });
            await jobs.started(run_id);
            refresh();
        } catch (err) { setError(err.message); }
        finally { setStarting(false); }
    };
    return { perform, error, busy: starting || jobs.busy };
}
