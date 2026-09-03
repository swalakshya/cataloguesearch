// Shared between TopBar (desktop links) and Sidebar's mobile drawer (which also
// carries page navigation, since the top bar's links hide below the desktop
// breakpoint). Admin is intentionally excluded — it's a separate standalone
// route outside this shell and out of scope for this design pass.

// Primary links, shown directly in the bar.
export const NAV_ITEMS = [
    { id: 'home', label: 'Home', path: '/' },
    { id: 'chat', label: 'Ask AI!', path: '/chat' },
    { id: 'aagam-khoj', label: 'Aagam Khoj', path: '/aagam-khoj' },
];

// Grouped under the "Navigate" hover/click dropdown.
export const NAV_DROPDOWN_LABEL = 'Navigate';
export const NAV_DROPDOWN_ITEMS = [
    { id: 'about', label: 'About', path: '/about' },
    { id: 'usage-guide', label: 'Usage Guide', path: '/usage-guide' },
    { id: 'search-index', label: 'Content', path: '/search-index' },
    { id: 'whats-new', label: "What's New?", path: '/whats-new' },
];

// Trailing links, shown directly in the bar after the dropdown.
export const NAV_TAIL_ITEMS = [
    { id: 'developer', label: 'Build with Swalakshya', path: '/developer' },
    { id: 'feedback', label: 'Feedback', path: '/feedback' },
];

// Flat list for the mobile drawer, where a hover dropdown doesn't apply — every
// page just gets listed in order.
export const ALL_NAV_ITEMS = [...NAV_ITEMS, ...NAV_DROPDOWN_ITEMS, ...NAV_TAIL_ITEMS];
