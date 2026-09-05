import { useEffect, useRef, useState } from 'react';

// True while the page is actively being scrolled, false again shortly after
// it stops — lets floating UI (e.g. the mobile Home/Feedback buttons in
// App.js) get out of the way of content while scrolling, on any page, without
// each caller wiring up its own listener.
export function useHideOnScroll(idleDelay = 400) {
    const [scrolling, setScrolling] = useState(false);
    const timeoutRef = useRef(null);

    useEffect(() => {
        const handleScroll = () => {
            setScrolling(true);
            clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => setScrolling(false), idleDelay);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', handleScroll);
            clearTimeout(timeoutRef.current);
        };
    }, [idleDelay]);

    return scrolling;
}
