/**
 * Chat Agent — Tool executor map and action execution
 */

import logger from '../../utils/logger.js';
import type { ToolInput } from './types.js';
import { MUTATING_TOOLS } from './tools.js';
import { execSearchInventory, execGetSkuBalance, execSearchOrders, execSearchFabrics, execLookupSku } from './readTools.js';
import { execAddFabricInward, execAddInventoryInward, execAddInventoryOutward, execAdjustInventory } from './mutatingTools.js';

const log = logger.child({ module: 'chatAgent' });

// ============================================
// TOOL ROUTER
// ============================================

/** Map of tool name -> executor function */
export const TOOL_EXECUTORS: Record<string, (input: ToolInput, userId: string) => Promise<unknown>> = {
    search_inventory: execSearchInventory,
    get_sku_balance: execGetSkuBalance,
    search_orders: execSearchOrders,
    search_fabrics: execSearchFabrics,
    lookup_sku: execLookupSku,
    add_fabric_inward: execAddFabricInward,
    add_inventory_inward: execAddInventoryInward,
    add_inventory_outward: execAddInventoryOutward,
    adjust_inventory: execAdjustInventory,
};

// ============================================
// ACTION DESCRIPTION HELPER
// ============================================

/**
 * Returns a human-readable description of a mutating action.
 * Shown on the confirmation card before the user approves.
 */
export function generateActionDescription(toolName: string, toolInput: Record<string, unknown>): string {
    switch (toolName) {
        case 'add_fabric_inward': {
            const qty = toolInput.qty ?? '?';
            const unit = toolInput.unit ?? 'units';
            return `Add ${qty} ${unit} of fabric inward`;
        }
        case 'add_inventory_inward': {
            const qty = toolInput.qty ?? '?';
            return `Add ${qty} units of inventory inward (${toolInput.reason ?? 'unspecified reason'})`;
        }
        case 'add_inventory_outward': {
            const qty = toolInput.qty ?? '?';
            return `Remove ${qty} units of inventory (${toolInput.reason ?? 'unspecified reason'})`;
        }
        case 'adjust_inventory': {
            const newBal = toolInput.newBalance ?? '?';
            return `Adjust inventory balance to ${newBal} units (${toolInput.reason ?? 'unspecified reason'})`;
        }
        default:
            return `Execute ${toolName}`;
    }
}

// ============================================
// EXECUTE CONFIRMED ACTION
// ============================================

/**
 * Execute a mutating tool after the user has confirmed it.
 *
 * @param toolName - Name of the mutating tool
 * @param toolInput - Tool parameters
 * @param userId - ID of the user who confirmed (used as createdById)
 */
export async function executeAction(
    toolName: string,
    toolInput: Record<string, unknown>,
    userId: string,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!MUTATING_TOOLS.has(toolName)) {
        return { success: false, error: `Unknown or non-mutating tool: ${toolName}` };
    }

    const executor = TOOL_EXECUTORS[toolName];
    if (!executor) {
        return { success: false, error: `No executor found for tool: ${toolName}` };
    }

    try {
        log.info({ toolName, toolInput, userId }, 'Executing confirmed action');
        const result = await executor(toolInput, userId);

        // Check if the tool returned an error object
        if (result && typeof result === 'object' && 'error' in result) {
            return { success: false, error: String((result as { error: string }).error) };
        }

        return { success: true, data: result };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error executing action';
        log.error({ toolName, toolInput, error: message }, 'Action execution failed');
        return { success: false, error: message };
    }
}
