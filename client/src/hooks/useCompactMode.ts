/**
 * useCompactMode Hook
 *
 * Manages UI density toggle with localStorage persistence.
 * Toggles `.compact-mode` class on document element which
 * overrides CSS density variables defined in index.css.
 *
 * Usage:
 * const { isCompact, toggle } = useCompactMode();
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'coh-compact-mode';

export function useCompactMode() {
    const [isCompact, setIsCompact] = useState(false);

    // Hydrate from localStorage after mount to avoid SSR mismatch
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'true') setIsCompact(true);
    }, []);

    // Sync class with state
    useEffect(() => {
        document.documentElement.classList.toggle('compact-mode', isCompact);
        localStorage.setItem(STORAGE_KEY, String(isCompact));
    }, [isCompact]);

    const toggle = useCallback(() => {
        setIsCompact((prev) => !prev);
    }, []);

    return { isCompact, toggle, setIsCompact };
}
