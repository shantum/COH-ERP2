/**
 * Unit tests for Order Line Status State Machine
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
    buildTransitionError,
    LINE_STATUS_TRANSITIONS,
    LINE_STATUSES,
    STATUSES_WITH_ALLOCATED_INVENTORY,
    type LineStatus,
} from '@coh/shared/domain';

describe('orderStateMachine', () => {
    describe('LINE_STATUSES constant', () => {
        it('contains all expected statuses', () => {
            expect(LINE_STATUSES).toEqual([
                'pending',
                'allocated',
                'picked',
                'packed',
                'shipped',
                'delivered',
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

        it('shipped can transition to packed or delivered', () => {
            expect(getValidTargetStatuses('shipped')).toEqual(['packed', 'delivered']);
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

        it('returns packed and delivered as targets for shipped', () => {
            expect(getValidTargetStatuses('shipped')).toEqual(['packed', 'delivered']);
        });

        it('returns shipped as target for delivered (revert)', () => {
            expect(getValidTargetStatuses('delivered')).toEqual(['shipped']);
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

        it('handles shipped status with packed as target', () => {
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
