import React from 'react';
import LiveLogViewer from '../logviewer/LiveLogViewer';

export default function ServiceLogs({ service, revision }) {
    return <LiveLogViewer key={service} path={`/local-services/${service}/logs`} revision={revision} />;
}
