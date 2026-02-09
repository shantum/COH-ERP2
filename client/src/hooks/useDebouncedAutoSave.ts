/**
 * Debounced Auto-Save Hook
 *
 * Provides debounced auto-save functionality with optimistic UI updates.
 * Used for inline table cell edits (Notes, Dates, etc.)
 *
 * Features:
 * - Debounced saves (500ms default) - waits for user to stop typing
 * - Optimistic UI - updates immediately, reverts on error
 * - Zod validation - validates before sending to server
 * - onBlur save - immediate save on blur (no debounce wait)
 * - Loading/error states
 * - onSettled callback - CRITICAL for data sync (refetch after mutation)
 *
 * @example
 * const { value, setValue, handleBlur, isSaving, error } = useDebouncedAutoSave({
 *   initialValue: row.notes,
 *   schema: UpdateLineNotesSchema,
 *   mutationFn: (data) => updateLineNotes.mutateAsync(data),
 *   buildPayload: (value) => ({ lineId: row.id, notes: value }),
 *   onSuccess: () => console.log('Saved!'),
 *   // CRITICAL: Always use onSettled to refetch data for UI/DB sync
 *   // Use targeted invalidation, NOT broad ['orders'] key (causes 10K+ re-renders)
 *   onSettled: () => invalidateAllOrderViewsStale(queryClient),
 * });
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { z } from 'zod';

interface UseDebouncedAutoSaveOptions<TValue, TPayload> {
    /** Initial value from server */
    initialValue: TValue;
    /** Zod schema for validation */
    schema: z.ZodSchema<TPayload>;
    /** Mutation function to call */
    mutationFn: (payload: TPayload) => Promise<unknown>;
    /** Build the payload from the current value */
    buildPayload: (value: TValue) => TPayload;
    /** Callback on successful save */
    onSuccess?: () => void;
    /** Callback on error */
    onError?: (error: Error) => void;
    /**
     * Callback after mutation settles (success OR error).
     * Use this to refetch data and ensure UI/DB sync.
     * This is CRITICAL for data consistency.
     */
    onSettled?: () => void;
    /** Debounce delay in ms (default: 500) */
    debounceMs?: number;
    /** Whether to save on blur immediately (default: true) */
    saveOnBlur?: boolean;
}

interface UseDebouncedAutoSaveReturn<TValue> {
    /** Current value (optimistic) */
    value: TValue;
    /** Set value (triggers debounced save) */
    setValue: (value: TValue) => void;
    /** Handle blur - saves immediately without debounce */
    handleBlur: () => void;
    /** Whether a save is in progress */
    isSaving: boolean;
    /** Validation or server error */
    error: string | null;
    /** Reset to initial value */
    reset: () => void;
    /** Whether the value has been modified */
    isDirty: boolean;
}

export function useDebouncedAutoSave<TValue, TPayload>({
    initialValue,
    schema,
    mutationFn,
    buildPayload,
    onSuccess,
    onError,
    onSettled,
    debounceMs = 500,
    saveOnBlur = true,
}: UseDebouncedAutoSaveOptions<TValue, TPayload>): UseDebouncedAutoSaveReturn<TValue> {
    // Optimistic value (what user sees immediately)
    const [value, setValueState] = useState<TValue>(initialValue);
    // Last successfully saved value (for rollback)
    const [savedValue, setSavedValue] = useState<TValue>(initialValue);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Refs for debounce and pending save
    const debounceRef = useRef<NodeJS.Timeout | null>(null);
    const pendingValueRef = useRef<TValue>(initialValue);
    const isMountedRef = useRef(true);

    // Track if value differs from saved
    const isDirty = value !== savedValue;

    // Cleanup on unmount
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);

    // Update initial value when it changes from server
    useEffect(() => {
        if (!isSaving && initialValue !== savedValue) {
            setValueState(initialValue);
            setSavedValue(initialValue);
            pendingValueRef.current = initialValue;
        }
    }, [initialValue, isSaving, savedValue]);

    // Save function
    const save = useCallback(async (valueToSave: TValue) => {
        // Skip if value hasn't changed from last saved
        if (valueToSave === savedValue) {
            return;
        }

        setError(null);

        // Build and validate payload
        const payload = buildPayload(valueToSave);
        const validation = schema.safeParse(payload);

        if (!validation.success) {
            const errorMsg = validation.error.issues[0]?.message || 'Validation failed';
            setError(errorMsg);
            return;
        }

        setIsSaving(true);

        try {
            await mutationFn(validation.data);

            if (isMountedRef.current) {
                setSavedValue(valueToSave);
                setError(null);
                onSuccess?.();
            }
        } catch (err) {
            if (isMountedRef.current) {
                // Rollback optimistic update on error
                setValueState(savedValue);
                const errorMsg = err instanceof Error ? err.message : 'Save failed';
                setError(errorMsg);
                onError?.(err instanceof Error ? err : new Error(errorMsg));
            }
        } finally {
            if (isMountedRef.current) {
                setIsSaving(false);
                // CRITICAL: Always call onSettled to refetch and ensure UI/DB sync
                onSettled?.();
            }
        }
    }, [savedValue, buildPayload, schema, mutationFn, onSuccess, onError, onSettled]);

    // Set value with debounced auto-save
    const setValue = useCallback((newValue: TValue) => {
        // Update optimistic value immediately (no flicker)
        setValueState(newValue);
        pendingValueRef.current = newValue;
        setError(null);

        // Clear existing debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        // Set new debounce
        debounceRef.current = setTimeout(() => {
            save(pendingValueRef.current);
        }, debounceMs);
    }, [save, debounceMs]);

    // Handle blur - save immediately (no debounce wait)
    const handleBlur = useCallback(() => {
        if (!saveOnBlur) return;

        // Clear any pending debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }

        // Save immediately if dirty
        if (pendingValueRef.current !== savedValue) {
            save(pendingValueRef.current);
        }
    }, [save, savedValue, saveOnBlur]);

    // Reset to initial value
    const reset = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        setValueState(initialValue);
        setSavedValue(initialValue);
        pendingValueRef.current = initialValue;
        setError(null);
    }, [initialValue]);

    return {
        value,
        setValue,
        handleBlur,
        isSaving,
        error,
        reset,
        isDirty,
    };
}

/**
 * Simple debounced callback hook (for non-auto-save use cases)
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
    callback: T,
    delay: number
): T {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const debouncedCallback = useCallback((...args: Parameters<T>) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
            callback(...args);
        }, delay);
    }, [callback, delay]) as T;

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return debouncedCallback;
}
