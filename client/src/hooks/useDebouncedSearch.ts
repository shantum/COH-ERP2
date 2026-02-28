/**
 * useDebouncedSearch — local search input with debounced URL sync.
 *
 * Manages a controlled text input that syncs to URL search params
 * after a debounce delay, only when the value actually changed.
 */

import { useState, useEffect, useRef } from 'react';
import { useDebounce } from './useDebounce';

interface UseDebouncedSearchOptions {
  /** Current URL search param value */
  urlValue: string | undefined;
  /** Called when debounced value differs from URL — update the URL here */
  onSync: (value: string | undefined) => void;
  /** Debounce delay in ms (default 300) */
  delay?: number;
}

export function useDebouncedSearch({ urlValue, onSync, delay = 300 }: UseDebouncedSearchOptions) {
  const [searchInput, setSearchInput] = useState(urlValue ?? '');
  const debouncedSearch = useDebounce(searchInput, delay);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the initial render to avoid a spurious sync
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const normalised = debouncedSearch || undefined;
    if (normalised !== (urlValue || undefined)) {
      onSync(normalised);
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally sync only on debounced value change

  /** Reset input when URL value changes externally (e.g. tab switch) */
  const resetToUrl = () => setSearchInput(urlValue ?? '');

  return { searchInput, setSearchInput, resetToUrl } as const;
}
