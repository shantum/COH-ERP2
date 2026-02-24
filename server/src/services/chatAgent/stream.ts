/**
 * Chat Agent — Main SSE streaming loop
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import type { SSEChunk, ChatMessage, FileAttachment } from './types.js';
import { AI_MODEL, MAX_LOOP_ITERATIONS, SYSTEM_PROMPT, TOOLS, READ_ONLY_TOOLS, MUTATING_TOOLS } from './tools.js';
import { TOOL_EXECUTORS, generateActionDescription } from './executor.js';

const log = logger.child({ module: 'chatAgent' });

/**
 * Stream a chat response, automatically executing read-only tools
 * and pausing for confirmation on mutating tools.
 *
 * @param messages - Conversation history
 * @param userId - Current user ID (for transaction attribution)
 * @param files - Optional file attachments (images/PDFs)
 * @yields SSEChunk objects for the client to render
 */
export async function* streamChat(
    messages: ChatMessage[],
    userId: string,
    files?: FileAttachment[],
): AsyncGenerator<SSEChunk> {
    if (!env.ANTHROPIC_API_KEY) {
        yield { type: 'error', message: 'Anthropic API key is not configured.' };
        yield { type: 'done' };
        return;
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    // Build the messages array for the API call
    const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((msg, idx) => {
        // For the last user message, attach files if provided
        if (msg.role === 'user' && idx === messages.length - 1 && files && files.length > 0) {
            const fileBlocks: Anthropic.Messages.ContentBlockParam[] = files.map(f => {
                if (f.mimeType === 'application/pdf') {
                    return {
                        type: 'document' as const,
                        source: {
                            type: 'base64' as const,
                            media_type: 'application/pdf' as const,
                            data: f.base64Data,
                        },
                    };
                }
                return {
                    type: 'image' as const,
                    source: {
                        type: 'base64' as const,
                        media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                        data: f.base64Data,
                    },
                };
            });

            const textContent = typeof msg.content === 'string' ? msg.content : '';
            return {
                role: 'user' as const,
                content: [
                    ...fileBlocks,
                    { type: 'text' as const, text: textContent },
                ],
            };
        }

        return {
            role: msg.role,
            content: msg.content as string | Anthropic.Messages.ContentBlockParam[],
        };
    });

    // Conversation loop: Claude may call read-only tools multiple times
    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
        try {
            // Use streaming for text deltas
            const stream = client.messages.stream({
                model: AI_MODEL,
                max_tokens: 4096,
                system: SYSTEM_PROMPT,
                tools: TOOLS,
                messages: apiMessages,
            });

            // Collect the full response for tool handling
            const response = await stream.finalMessage();

            // Process each content block
            let hasToolUse = false;
            let pendingAction = false;

            for (const block of response.content) {
                if (block.type === 'text' && block.text) {
                    yield { type: 'text_delta', text: block.text };
                }

                if (block.type === 'tool_use') {
                    const toolName = block.name;
                    const toolInput = block.input as Record<string, unknown>;
                    const toolUseId = block.id;

                    if (READ_ONLY_TOOLS.has(toolName)) {
                        // Auto-execute read-only tools
                        hasToolUse = true;
                        log.info({ toolName, toolInput }, 'Auto-executing read-only tool');

                        const executor = TOOL_EXECUTORS[toolName];
                        let result: unknown;
                        try {
                            result = executor
                                ? await executor(toolInput, userId)
                                : { error: `Unknown tool: ${toolName}` };
                        } catch (error: unknown) {
                            const errMsg = error instanceof Error ? error.message : 'Tool execution failed';
                            log.error({ toolName, error: errMsg }, 'Read-only tool execution failed');
                            result = { error: errMsg };
                        }

                        yield { type: 'tool_result', toolName, result };

                        // Append assistant message + tool result for next loop iteration
                        apiMessages.push({
                            role: 'assistant',
                            content: response.content,
                        });
                        apiMessages.push({
                            role: 'user',
                            content: [{
                                type: 'tool_result',
                                tool_use_id: toolUseId,
                                content: JSON.stringify(result),
                            }],
                        });

                    } else if (MUTATING_TOOLS.has(toolName)) {
                        // Pause for confirmation
                        pendingAction = true;
                        const actionId = randomUUID();
                        const description = generateActionDescription(toolName, toolInput);

                        log.info({ toolName, toolInput, actionId }, 'Mutating tool requires confirmation');

                        yield {
                            type: 'action_pending',
                            actionId,
                            toolName,
                            toolInput,
                            description,
                        };
                        // Stop the loop — client must confirm before we continue
                        break;
                    }
                }
            }

            // If a mutating tool is pending, stop the loop
            if (pendingAction) {
                break;
            }

            // If no tool was used, the response is complete
            if (!hasToolUse) {
                break;
            }

            // If stop_reason is end_turn (no more tools), break
            if (response.stop_reason === 'end_turn') {
                break;
            }

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error during chat';
            log.error({ error: message, iteration }, 'Chat stream error');
            yield { type: 'error', message };
            break;
        }
    }

    yield { type: 'done' };
}
