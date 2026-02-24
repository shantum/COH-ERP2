/**
 * Chat Agent Types
 */

import type Anthropic from '@anthropic-ai/sdk';

/** SSE chunk types sent to the client */
export type SSEChunk =
    | { type: 'text_delta'; text: string }
    | { type: 'action_pending'; actionId: string; toolName: string; toolInput: Record<string, unknown>; description: string }
    | { type: 'tool_result'; toolName: string; result: unknown }
    | { type: 'error'; message: string }
    | { type: 'done' };

/** Chat message format matching Anthropic's API */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string | Anthropic.Messages.ContentBlockParam[];
}

/** File attachment for image/PDF uploads */
export interface FileAttachment {
    base64Data: string;
    mimeType: string;
    fileName: string;
}

/** Generic tool input type */
export type ToolInput = Record<string, unknown>;
