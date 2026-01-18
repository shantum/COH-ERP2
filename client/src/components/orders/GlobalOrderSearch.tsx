/**
 * GlobalOrderSearch - Prominent search input for orders
 * When in search mode, replaces the view selector with search results in the grid
 * Supports Cmd+K keyboard shortcut for quick access
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Command } from 'lucide-react';

interface GlobalOrderSearchProps {
    /** Current search query (controlled) */
    searchQuery: string;
    /** Callback when search query changes */
    onSearchChange: (query: string) => void;
    /** Callback to clear search and return to normal view */
    onClearSearch: () => void;
    /** Whether we're currently in search mode */
    isSearchMode: boolean;
    /** Optional placeholder text */
    placeholder?: string;
}

export function GlobalOrderSearch({
    searchQuery,
    onSearchChange,
    onClearSearch,
    isSearchMode,
    placeholder = 'Search orders...',
}: GlobalOrderSearchProps) {
    const [localInput, setLocalInput] = useState(searchQuery);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync local input with external state
    useEffect(() => {
        setLocalInput(searchQuery);
    }, [searchQuery]);

    // Handle input change with debounce
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalInput(value);
        onSearchChange(value);
    }, [onSearchChange]);

    // Handle clear
    const handleClear = useCallback(() => {
        setLocalInput('');
        onClearSearch();
        inputRef.current?.focus();
    }, [onClearSearch]);

    // Keyboard shortcut: Cmd/Ctrl+K to focus search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
            }
            // Escape to clear search when focused
            if (e.key === 'Escape' && document.activeElement === inputRef.current) {
                if (localInput) {
                    handleClear();
                } else {
                    inputRef.current?.blur();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [localInput, handleClear]);

    return (
        <div className="relative flex items-center">
            <Search
                size={14}
                className={`absolute left-2.5 z-10 transition-colors ${
                    isSearchMode ? 'text-blue-500' : 'text-gray-400'
                }`}
            />
            <input
                ref={inputRef}
                type="text"
                placeholder={placeholder}
                value={localInput}
                onChange={handleChange}
                className={`pl-8 pr-16 py-1.5 text-xs border rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 ${
                    isSearchMode
                        ? 'w-56 sm:w-72 bg-blue-50 border-blue-200'
                        : 'w-44 sm:w-56 bg-gray-50/50 border-gray-200 hover:border-gray-300'
                }`}
            />
            {/* Show clear button when there's input */}
            {localInput ? (
                <button
                    onClick={handleClear}
                    className="absolute right-2 p-0.5 text-gray-400 hover:text-gray-600 rounded"
                    title="Clear search (Esc)"
                >
                    <X size={14} />
                </button>
            ) : (
                /* Show keyboard shortcut hint when empty */
                <div className="absolute right-2 flex items-center gap-0.5 text-[9px] text-gray-400 pointer-events-none">
                    <Command size={10} />
                    <span>K</span>
                </div>
            )}
        </div>
    );
}

export default GlobalOrderSearch;
