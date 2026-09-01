// Shared between TopBar (desktop links) and Sidebar's mobile drawer (which also
// carries page navigation, since the top bar's links hide below the desktop
// breakpoint). Admin is intentionally excluded — it's a separate standalone
// route outside this shell and out of scope for this design pass.
export const NAV_ITEMS = [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'chat', label: 'Swalakshya AI', path: '/chat' },
    { id: 'about', label: 'About', path: '/about' },
    { id: 'search-index', label: 'Content', path: '/search-index' },
    { id: 'usage-guide', label: 'Usage Guide', path: '/usage-guide' },
    { id: 'whats-new', label: "What's New?", path: '/whats-new' },
    { id: 'developer', label: 'Developer APIs', path: '/developer' },
    { id: 'feedback', label: 'Feedback', path: '/feedback' },
];
