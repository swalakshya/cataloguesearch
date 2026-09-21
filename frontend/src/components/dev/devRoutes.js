import React from 'react';
import { Route } from 'react-router-dom';
import DevShell from './DevShell';
import DevHome from './DevHome';
import DiscoverPage from '../discover/DiscoverPage';
import DeployPage from '../deploy/DeployPage';
import UIEval from '../eval/UIEval';

// The local dev tools' routes, all inside the Dev shell. Loaded by App.js only when dev tools are compiled in
// (see there), so this module and everything it imports stay out of the production bundle and the production image.
export default (
    <Route element={<DevShell />}>
        <Route path="/dev" element={<DevHome />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/deploy" element={<DeployPage />} />
        <Route path="/eval" element={<UIEval />} />
    </Route>
);
