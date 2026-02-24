/**
 * Chat Agent Service
 *
 * AI-powered conversational agent for the COH ERP system.
 * Wraps the Anthropic SDK with tool-use capabilities for querying
 * inventory, orders, fabrics, and performing stock adjustments.
 *
 * Read-only tools execute automatically. Mutating tools pause for
 * user confirmation before executing.
 */

export type { SSEChunk, ChatMessage, FileAttachment } from './types.js';
export { generateActionDescription, executeAction } from './executor.js';
export { streamChat } from './stream.js';
