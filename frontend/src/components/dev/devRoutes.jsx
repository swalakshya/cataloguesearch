import React from 'react';
import { Navigate, Route, useLocation } from 'react-router-dom';
import DevShell from './DevShell';
import DevHome from './DevHome';
import DiscoverPage from '../discover/DiscoverPage';
import DeployPage from '../deploy/DeployPage';
import CleanupTab from '../deploy/CleanupTab';
import BackupsTab from '../deploy/BackupsTab';
import UIEval from '../eval/UIEval';
import TestingPage from './testing/TestingPage';
import LocalServices from './LocalServices';
import ProductionPage from './ProductionPage';
import { PageShell } from './JobUI';

function LegacyTool({ to }) {
    const location = useLocation();
    const tab = new URLSearchParams(location.search).get('tab');
    const destination = to || ({ production: '/prod', cleanup: '/dev/cleanup', backups: '/dev/backups' }[tab] || '/dev/deploy');
    return <Navigate replace to={`${destination}${to ? location.search : tab === 'production' || tab === 'cleanup' || tab === 'backups' ? '' : location.search}${location.hash}`} />;
}

export default (
    <Route element={<DevShell />}>
        <Route path="/dev" element={<DevHome />} />
        <Route path="/dev/tests" element={<TestingPage />} />
        <Route path="/dev/services" element={<LocalServices />} />
        <Route path="/dev/discover" element={<DiscoverPage />} />
        <Route path="/dev/deploy" element={<DeployPage embedded />} />
        <Route path="/dev/cleanup" element={<PageShell title="🧹 Local cleanup" subtitle="🧑‍💻 This laptop"><CleanupTab fixedTarget="local" /></PageShell>} />
        <Route path="/dev/backups" element={<PageShell title="💾 Laptop backups" subtitle="🧑‍💻 Local data → Google Drive"><BackupsTab /></PageShell>} />
        <Route path="/dev/eval" element={<UIEval />} />
        <Route path="/prod" element={<ProductionPage />} />
        {['services', 'certificates', 'backups', 'cleanup', 'host'].map(section => <Route key={section} path={`/prod/${section}`} element={<ProductionPage section={section} />} />)}
        <Route path="/services" element={<LegacyTool to="/dev/services" />} />
        <Route path="/discover" element={<LegacyTool to="/dev/discover" />} />
        <Route path="/eval" element={<LegacyTool to="/dev/eval" />} />
        <Route path="/deploy" element={<LegacyTool />} />
    </Route>
);
