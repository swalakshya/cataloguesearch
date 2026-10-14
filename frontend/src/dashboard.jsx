import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeContext';
import devRoutes from './components/dev/devRoutes';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <ThemeProvider><BrowserRouter><Routes>
        {devRoutes}
        <Route path="*" element={<Navigate to="/dev" replace />} />
    </Routes></BrowserRouter></ThemeProvider>
);
