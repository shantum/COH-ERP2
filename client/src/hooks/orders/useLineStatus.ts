/**
 * useLineStatus Hook
 *
 * Provides computed status flags for order line operations.
 * Reduces duplication across cell components that check line status.
 *
 * @example
 * const status = useLineStatus(row.lineStatus);
 * if (status.canAllocate) { ... }
 * if (status.isShipped) { ... }
 */

import { useMemo } from 'react';

/**
 * Line status flags computed from the raw status string
 */
export interface LineStatusFlags {
    // Raw status string
    status: string;

    // Individual status checks
    isPending: boolean;
    isAllocated: boolean;
    isPicked: boolean;
    isPacked: boolean;
    isShipped: boolean;
    isCancelled: boolean;

    // Grouped status checks
    isInProgress: boolean;      // allocated | picked | packed
    isPostAllocated: boolean;   // picked | packed | shipped
    isPreShipped: boolean;      // pending | allocated | picked | packed
    isTerminal: boolean;        // shipped | cancelled

    // Capability checks (what can be done next)
    canAllocate: boolean;       // pending -> allocated
    canPick: boolean;           // allocated -> picked
    canPack: boolean;           // picked -> packed
    canShip: boolean;           // packed -> shipped
    canCancel: boolean;         // !shipped && !cancelled

    // Reverse capability checks
    canUnallocate: boolean;     // allocated -> pending
    canUnpick: boolean;         // picked -> allocated
    canUnpack: boolean;         // packed -> picked
    canUnship: boolean;         // shipped -> packed

    // Inventory relationship
    hasAllocatedInventory: boolean; // allocated | picked | packed | shipped
}

/**
 * Hook that computes line status flags from a status string
 *
 * @param lineStatus - The raw line status string
 * @returns Computed status flags
 */
export function useLineStatus(lineStatus: string | undefined | null): LineStatusFlags {
    return useMemo(() => {
        const status = lineStatus || 'pending';

        // Individual status checks
        const isPending = status === 'pending';
        const isAllocated = status === 'allocated';
        const isPicked = status === 'picked';
        const isPacked = status === 'packed';
        const isShipped = status === 'shipped';
        const isCancelled = status === 'cancelled';

        // Grouped status checks
        const isInProgress = isAllocated || isPicked || isPacked;
        const isPostAllocated = isPicked || isPacked || isShipped;
        const isPreShipped = isPending || isAllocated || isPicked || isPacked;
        const isTerminal = isShipped || isCancelled;

        // Capability checks
        const canAllocate = isPending;
        const canPick = isAllocated;
        const canPack = isPicked;
        const canShip = isPacked;
        const canCancel = !isShipped && !isCancelled;

        // Reverse capability checks
        const canUnallocate = isAllocated;
        const canUnpick = isPicked;
        const canUnpack = isPacked;
        const canUnship = isShipped;

        // Inventory relationship
        const hasAllocatedInventory = isAllocated || isPicked || isPacked || isShipped;

        return {
            status,
            isPending,
            isAllocated,
            isPicked,
            isPacked,
            isShipped,
            isCancelled,
            isInProgress,
            isPostAllocated,
            isPreShipped,
            isTerminal,
            canAllocate,
            canPick,
            canPack,
            canShip,
            canCancel,
            canUnallocate,
            canUnpick,
            canUnpack,
            canUnship,
            hasAllocatedInventory,
        };
    }, [lineStatus]);
}

/**
 * Pure function version for use outside React components
 * Same logic as the hook but without useMemo
 *
 * @param lineStatus - The raw line status string
 * @returns Computed status flags
 */
export function getLineStatusFlags(lineStatus: string | undefined | null): LineStatusFlags {
    const status = lineStatus || 'pending';

    const isPending = status === 'pending';
    const isAllocated = status === 'allocated';
    const isPicked = status === 'picked';
    const isPacked = status === 'packed';
    const isShipped = status === 'shipped';
    const isCancelled = status === 'cancelled';

    const isInProgress = isAllocated || isPicked || isPacked;
    const isPostAllocated = isPicked || isPacked || isShipped;
    const isPreShipped = isPending || isAllocated || isPicked || isPacked;
    const isTerminal = isShipped || isCancelled;

    const canAllocate = isPending;
    const canPick = isAllocated;
    const canPack = isPicked;
    const canShip = isPacked;
    const canCancel = !isShipped && !isCancelled;

    const canUnallocate = isAllocated;
    const canUnpick = isPicked;
    const canUnpack = isPacked;
    const canUnship = isShipped;

    const hasAllocatedInventory = isAllocated || isPicked || isPacked || isShipped;

    return {
        status,
        isPending,
        isAllocated,
        isPicked,
        isPacked,
        isShipped,
        isCancelled,
        isInProgress,
        isPostAllocated,
        isPreShipped,
        isTerminal,
        canAllocate,
        canPick,
        canPack,
        canShip,
        canCancel,
        canUnallocate,
        canUnpick,
        canUnpack,
        canUnship,
        hasAllocatedInventory,
    };
}
