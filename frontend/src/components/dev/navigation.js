export const AREAS = {
    dev: { label: 'Dev', icon: '🧑‍💻', home: '/dev', sections: [
        ['/dev/services', 'Local services', '⚙️'], ['/dev/tests', 'Tests & Coverage', '🧪'], ['/dev/discover', 'Discovery', '🔎'],
        ['/dev/deploy', 'Deploy', '🚀'], ['/dev/backups', 'Backups', '💾'], ['/dev/cleanup', 'Cleanup', '🧹'], ['/dev/eval', 'Eval tools', '🧪'],
    ] },
    prod: { label: 'Prod', icon: '🌍', home: '/prod', sections: [
        ['/prod', 'Overview', '📊'], ['/prod/services', 'Services', '⚙️'], ['/prod/certificates', 'Certificates', '🔐'],
        ['/prod/backups', 'Backups & restore', '💾'], ['/prod/cleanup', 'Cleanup', '🧹'], ['/prod/host', 'Host maintenance', '🛠️'],
    ] },
};

export function areaFor(path) { return path.startsWith('/prod') ? 'prod' : 'dev'; }
export function toolFor(path) {
    const legacy = { '/services': '/dev/services', '/discover': '/dev/discover', '/deploy': '/dev/deploy', '/eval': '/dev/eval' };
    return legacy[path] || path;
}
