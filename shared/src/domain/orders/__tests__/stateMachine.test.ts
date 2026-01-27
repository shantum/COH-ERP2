/**
 * Unit tests for Order Line Status State Machine (shared domain)
 */

import {
    isValidTransition,
    getTransitionDefinition,
    getValidTargetStatuses,
    isValidLineStatus,
    transitionAffectsInventory,
    releasesInventory,
    allocatesInventory,
    hasAllocatedInventory,
    statusShowsInventoryAllocated,
    calculateInventoryDelta,
    buildTransitionError,
    LINE_STATUS_TRANSITIONS,
    LINE_STATUSES,
    STATUSES_WITH_ALLOCATED_INVENTORY,
    STATUSES_SHOWING_INVENTORY_ALLOCATED,
    type LineStatus,
} from '../stateMachine.js';

describe('orderStateMachine', () => {
    describe('LINE_STATUSES constant', () => {
        it('contains all expected statuses', () => {
            expect(LINE_STATUSES).toEqual([
                'pending',
                'allocated',
                'picked',
                'packed',
                'shipped',
                'cancelled',
            ]);
        });
    });

    describe('STATUSES_WITH_ALLOCATED_INVENTORY constant', () => {
        it('contains statuses that have inventory allocated', () => {
            expect(STATUSES_WITH_ALLOCATED_INVENTORY).toEqual([
                'allocated',
                'picked',
                'packed',
            ]);
        });
    });

    describe('STATUSES_SHOWING_INVENTORY_ALLOCATED constant', () => {
        it('contains statuses that show inventory as allocated in the UI', () => {
            expect(STATUSES_SHOWING_INVENTORY_ALLOCATED).toEqual([
                'allocated',
                'picked',
                'packed',
                'shipped',
            ]);
        });

        it('includes shipped (unlike STATUSES_WITH_ALLOCATED_INVENTORY)', () => {
            expect(STATUSES_SHOWING_INVENTORY_ALLOCATED).toContain('shipped');
            expect(STATUSES_WITH_ALLOCATED_INVENTORY).not.toContain('shipped');
        });

        it('does not include pending or cancelled', () => {
            expect(STATUSES_SHOWING_INVENTORY_ALLOCATED).not.toContain('pending');
            expect(STATUSES_SHOWING_INVENTORY_ALLOCATED).not.toContain('cancelled');
        });
    });

    describe('isValidLineStatus', () => {
        it('returns true for valid statuses', () => {
            expect(isValidLineStatus('pending')).toBe(true);
            expect(isValidLineStatus('allocated')).toBe(true);
            expect(isValidLineStatus('picked')).toBe(true);
            expect(isValidLineStatus('packed')).toBe(true);
            expect(isValidLineStatus('shipped')).toBe(true);
            expect(isValidLineStatus('cancelled')).toBe(true);
        });

        it('returns false for invalid statuses', () => {
            expect(isValidLineStatus('invalid')).toBe(false);
            expect(isValidLineStatus('')).toBe(false);
            expect(isValidLineStatus('PENDING')).toBe(false); // case sensitive
        });
    });

    describe('isValidTransition - Forward Progression', () => {
        it('allows pending -> allocated', () => {
            expect(isValidTransition('pending', 'allocated')).toBe(true);
        });

        it('allows allocated -> picked', () => {
            expect(isValidTransition('allocated', 'picked')).toBe(true);
        });

        it('allows picked -> packed', () => {
            expect(isValidTransition('picked', 'packed')).toBe(true);
        });

        it('allows packed -> shipped', () => {
            expect(isValidTransition('packed', 'shipped')).toBe(true);
        });
    });

    describe('isValidTransition - Backward Corrections', () => {
        it('allows allocated -> pending (unallocate)', () => {
            expect(isValidTransition('allocated', 'pending')).toBe(true);
        });

        it('allows picked -> allocated (unpick)', () => {
            expect(isValidTransition('picked', 'allocated')).toBe(true);
        });

        it('allows packed -> picked (unpack)', () => {
            expect(isValidTransition('packed', 'picked')).toBe(true);
        });

        it('allows shipped -> packed (unship)', () => {
            expect(isValidTransition('shipped', 'packed')).toBe(true);
        });
    });

    describe('isValidTransition - Cancellation', () => {
        it('allows pending -> cancelled', () => {
            expect(isValidTransition('pending', 'cancelled')).toBe(true);
        });

        it('allows allocated -> cancelled', () => {
            expect(isValidTransition('allocated', 'cancelled')).toBe(true);
        });

        it('allows picked -> cancelled', () => {
            expect(isValidTransition('picked', 'cancelled')).toBe(true);
        });

        it('allows packed -> cancelled', () => {
            expect(isValidTransition('packed', 'cancelled')).toBe(true);
        });

        it('does NOT allow shipped -> cancelled', () => {
            expect(isValidTransition('shipped', 'cancelled')).toBe(false);
        });
    });

    describe('isValidTransition - Uncancellation', () => {
        it('allows cancelled -> pending (uncancel)', () => {
            expect(isValidTransition('cancelled', 'pending')).toBe(true);
        });

        it('does NOT allow cancelled -> allocated (must go through pending)', () => {
            expect(isValidTransition('cancelled', 'allocated')).toBe(false);
        });
    });

    describe('isValidTransition - Invalid Transitions', () => {
        it('does NOT allow pending -> shipped (skip steps)', () => {
            expect(isValidTransition('pending', 'shipped')).toBe(false);
        });

        it('does NOT allow pending -> picked (skip steps)', () => {
            expect(isValidTransition('pending', 'picked')).toBe(false);
        });

        it('does NOT allow pending -> packed (skip steps)', () => {
            expect(isValidTransition('pending', 'packed')).toBe(false);
        });

        it('shipped can only go to packed (unship)', () => {
            expect(getValidTargetStatuses('shipped')).toEqual(['packed']);
        });
    });

    describe('getTransitionDefinition', () => {
        it('returns correct definition for allocation', () => {
            const def = getTransitionDefinition('pending', 'allocated');
            expect(def).not.toBeNull();
            expect(def?.to).toBe('allocated');
            expect(def?.inventoryEffect).toBe('create_outward');
            expect(def?.requiresStockCheck).toBe(true);
            expect(def?.timestamps).toContainEqual({ field: 'allocatedAt', action: 'set' });
        });

        it('returns correct definition for unallocation', () => {
            const def = getTransitionDefinition('allocated', 'pending');
            expect(def).not.toBeNull();
            expect(def?.inventoryEffect).toBe('delete_outward');
            expect(def?.timestamps).toContainEqual({ field: 'allocatedAt', action: 'clear' });
        });

        it('returns correct definition for picking', () => {
            const def = getTransitionDefinition('allocated', 'picked');
            expect(def).not.toBeNull();
            expect(def?.inventoryEffect).toBe('none');
            expect(def?.timestamps).toContainEqual({ field: 'pickedAt', action: 'set' });
        });

        it('returns correct definition for packing', () => {
            const def = getTransitionDefinition('picked', 'packed');
            expect(def).not.toBeNull();
            expect(def?.inventoryEffect).toBe('none');
            expect(def?.timestamps).toContainEqual({ field: 'packedAt', action: 'set' });
        });

        it('returns correct definition for shipping', () => {
            const def = getTransitionDefinition('packed', 'shipped');
            expect(def).not.toBeNull();
            expect(def?.requiresShipData).toBe(true);
            expect(def?.timestamps).toContainEqual({ field: 'shippedAt', action: 'set' });
        });

        it('returns correct definition for unshipping', () => {
            const def = getTransitionDefinition('shipped', 'packed');
            expect(def).not.toBeNull();
            expect(def?.inventoryEffect).toBe('none');
            expect(def?.timestamps).toContainEqual({ field: 'shippedAt', action: 'clear' });
            expect(def?.description).toContain('Unship');
        });

        it('returns correct definition for cancel with inventory', () => {
            const def = getTransitionDefinition('allocated', 'cancelled');
            expect(def).not.toBeNull();
            expect(def?.inventoryEffect).toBe('delete_outward');
        });

        it('returns correct definition for cancel without inventory', () => {
            const def = getTransitionDefinition('pending', 'cancelled');
            expect(def).not.toBeNull();
            expect(def?.inventoryEffect).toBe('none');
        });

        it('returns null for invalid transition', () => {
            const def = getTransitionDefinition('pending', 'shipped');
            expect(def).toBeNull();
        });
    });

    describe('getValidTargetStatuses', () => {
        it('returns correct targets for pending', () => {
            expect(getValidTargetStatuses('pending')).toEqual(['allocated', 'cancelled']);
        });

        it('returns correct targets for allocated', () => {
            expect(getValidTargetStatuses('allocated')).toEqual(['pending', 'picked', 'cancelled']);
        });

        it('returns correct targets for picked', () => {
            expect(getValidTargetStatuses('picked')).toEqual(['allocated', 'packed', 'cancelled']);
        });

        it('returns correct targets for packed', () => {
            expect(getValidTargetStatuses('packed')).toEqual(['picked', 'shipped', 'cancelled']);
        });

        it('returns packed as the only target for shipped (unship)', () => {
            expect(getValidTargetStatuses('shipped')).toEqual(['packed']);
        });

        it('returns correct targets for cancelled', () => {
            expect(getValidTargetStatuses('cancelled')).toEqual(['pending']);
        });
    });

    describe('transitionAffectsInventory', () => {
        it('returns true for allocation', () => {
            expect(transitionAffectsInventory('pending', 'allocated')).toBe(true);
        });

        it('returns true for unallocation', () => {
            expect(transitionAffectsInventory('allocated', 'pending')).toBe(true);
        });

        it('returns true for cancel with allocated inventory', () => {
            expect(transitionAffectsInventory('allocated', 'cancelled')).toBe(true);
            expect(transitionAffectsInventory('picked', 'cancelled')).toBe(true);
            expect(transitionAffectsInventory('packed', 'cancelled')).toBe(true);
        });

        it('returns false for cancel without allocated inventory', () => {
            expect(transitionAffectsInventory('pending', 'cancelled')).toBe(false);
        });

        it('returns false for picking/packing', () => {
            expect(transitionAffectsInventory('allocated', 'picked')).toBe(false);
            expect(transitionAffectsInventory('picked', 'packed')).toBe(false);
        });

        it('returns false for shipping', () => {
            expect(transitionAffectsInventory('packed', 'shipped')).toBe(false);
        });
    });

    describe('allocatesInventory', () => {
        it('returns true only for pending -> allocated', () => {
            expect(allocatesInventory('pending', 'allocated')).toBe(true);
        });

        it('returns false for other transitions', () => {
            expect(allocatesInventory('allocated', 'picked')).toBe(false);
            expect(allocatesInventory('picked', 'packed')).toBe(false);
            expect(allocatesInventory('packed', 'shipped')).toBe(false);
            expect(allocatesInventory('pending', 'cancelled')).toBe(false);
        });
    });

    describe('releasesInventory', () => {
        it('returns true for unallocation', () => {
            expect(releasesInventory('allocated', 'pending')).toBe(true);
        });

        it('returns true for cancel with allocated inventory', () => {
            expect(releasesInventory('allocated', 'cancelled')).toBe(true);
            expect(releasesInventory('picked', 'cancelled')).toBe(true);
            expect(releasesInventory('packed', 'cancelled')).toBe(true);
        });

        it('returns false for cancel without allocated inventory', () => {
            expect(releasesInventory('pending', 'cancelled')).toBe(false);
        });

        it('returns false for forward progression', () => {
            expect(releasesInventory('pending', 'allocated')).toBe(false);
            expect(releasesInventory('allocated', 'picked')).toBe(false);
        });
    });

    describe('hasAllocatedInventory', () => {
        it('returns true for statuses with allocated inventory', () => {
            expect(hasAllocatedInventory('allocated')).toBe(true);
            expect(hasAllocatedInventory('picked')).toBe(true);
            expect(hasAllocatedInventory('packed')).toBe(true);
        });

        it('returns false for statuses without allocated inventory', () => {
            expect(hasAllocatedInventory('pending')).toBe(false);
            expect(hasAllocatedInventory('shipped')).toBe(false);
            expect(hasAllocatedInventory('cancelled')).toBe(false);
        });
    });

    describe('statusShowsInventoryAllocated', () => {
        it('returns true for allocated/picked/packed/shipped', () => {
            expect(statusShowsInventoryAllocated('allocated')).toBe(true);
            expect(statusShowsInventoryAllocated('picked')).toBe(true);
            expect(statusShowsInventoryAllocated('packed')).toBe(true);
            expect(statusShowsInventoryAllocated('shipped')).toBe(true);
        });

        it('returns false for pending and cancelled', () => {
            expect(statusShowsInventoryAllocated('pending')).toBe(false);
            expect(statusShowsInventoryAllocated('cancelled')).toBe(false);
        });

        it('returns false for null and undefined', () => {
            expect(statusShowsInventoryAllocated(null)).toBe(false);
            expect(statusShowsInventoryAllocated(undefined)).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(statusShowsInventoryAllocated('')).toBe(false);
        });

        it('returns false for invalid status strings', () => {
            expect(statusShowsInventoryAllocated('invalid')).toBe(false);
            expect(statusShowsInventoryAllocated('SHIPPED')).toBe(false);
        });
    });

    describe('calculateInventoryDelta', () => {
        it('returns negative qty when transitioning to an allocated status (consuming)', () => {
            // pending -> allocated: inventory is being consumed
            expect(calculateInventoryDelta('pending', 'allocated', 5)).toBe(-5);
        });

        it('returns positive qty when transitioning from an allocated status to non-allocated (restoring)', () => {
            // allocated -> pending: inventory is being restored
            expect(calculateInventoryDelta('allocated', 'pending', 3)).toBe(3);
            // allocated -> cancelled: inventory is being restored
            expect(calculateInventoryDelta('allocated', 'cancelled', 10)).toBe(10);
            // shipped -> cancelled is not a valid transition, but delta logic is pure
            expect(calculateInventoryDelta('shipped', 'cancelled', 7)).toBe(7);
        });

        it('returns 0 when both statuses are allocated (no net change)', () => {
            // allocated -> picked: both show inventory allocated
            expect(calculateInventoryDelta('allocated', 'picked', 5)).toBe(0);
            // picked -> packed
            expect(calculateInventoryDelta('picked', 'packed', 5)).toBe(0);
            // packed -> shipped
            expect(calculateInventoryDelta('packed', 'shipped', 5)).toBe(0);
        });

        it('returns 0 when neither status is allocated (no net change)', () => {
            // pending -> cancelled: neither has allocated inventory
            expect(calculateInventoryDelta('pending', 'cancelled', 5)).toBe(0);
            // cancelled -> pending
            expect(calculateInventoryDelta('cancelled', 'pending', 5)).toBe(0);
        });

        it('scales with quantity', () => {
            expect(calculateInventoryDelta('pending', 'allocated', 1)).toBe(-1);
            expect(calculateInventoryDelta('pending', 'allocated', 100)).toBe(-100);
            expect(calculateInventoryDelta('allocated', 'pending', 1)).toBe(1);
            expect(calculateInventoryDelta('allocated', 'pending', 100)).toBe(100);
        });

        it('handles zero quantity', () => {
            // With qty=0, the result is always numerically zero (may be -0 for consuming transitions)
            expect(calculateInventoryDelta('pending', 'allocated', 0) === 0).toBe(true);
            expect(calculateInventoryDelta('allocated', 'pending', 0) === 0).toBe(true);
            expect(calculateInventoryDelta('pending', 'cancelled', 0) === 0).toBe(true);
        });
    });

    describe('buildTransitionError', () => {
        it('builds correct error message', () => {
            const error = buildTransitionError('pending', 'shipped');
            expect(error).toContain('Cannot transition');
            expect(error).toContain('pending');
            expect(error).toContain('shipped');
            expect(error).toContain('allocated, cancelled');
        });

        it('handles invalid from status', () => {
            const error = buildTransitionError('invalid', 'allocated');
            expect(error).toContain('unknown');
        });

        it('handles shipped status with only packed as target', () => {
            const error = buildTransitionError('shipped', 'cancelled');
            expect(error).toContain('packed');
        });
    });

    describe('LINE_STATUS_TRANSITIONS completeness', () => {
        it('has definitions for all LINE_STATUSES', () => {
            for (const status of LINE_STATUSES) {
                expect(LINE_STATUS_TRANSITIONS[status]).toBeDefined();
                expect(Array.isArray(LINE_STATUS_TRANSITIONS[status])).toBe(true);
            }
        });

        it('all transition targets are valid LineStatuses', () => {
            for (const status of LINE_STATUSES) {
                const transitions = LINE_STATUS_TRANSITIONS[status];
                for (const def of transitions) {
                    expect(LINE_STATUSES).toContain(def.to);
                }
            }
        });

        it('all transitions have required fields', () => {
            for (const status of LINE_STATUSES) {
                const transitions = LINE_STATUS_TRANSITIONS[status];
                for (const def of transitions) {
                    expect(def.to).toBeDefined();
                    expect(def.inventoryEffect).toBeDefined();
                    expect(def.timestamps).toBeDefined();
                    expect(def.description).toBeDefined();
                    expect(['none', 'create_outward', 'delete_outward']).toContain(def.inventoryEffect);
                }
            }
        });
    });
});
