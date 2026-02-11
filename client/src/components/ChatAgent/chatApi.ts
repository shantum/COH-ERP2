/**
 * Chat Agent API helpers
 *
 * Handles streaming responses from the chat endpoint
 * and confirming pending actions.
 */

// Always use relative /api — Vite proxy handles dev routing to Express
const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ============================================
// TYPES
// ============================================

export type SSEChunk =
    | { type: 'text_delta'; text: string }
    | { type: 'action_pending'; actionId: string; toolName: string; toolInput: Record<string, unknown>; description: string }
    | { type: 'tool_result'; toolName: string; result: unknown }
    | { type: 'error'; message: string }
    | { type: 'done' };

export interface ChatMessagePayload {
    role: 'user' | 'assistant';
    content: string;
}

// ============================================
// STREAM CHAT MESSAGE
// ============================================

/**
 * Send a chat message and stream back the response.
 * Calls the onChunk callback for each SSE event.
 */
export async function streamMessage(
    messages: ChatMessagePayload[],
    onChunk: (chunk: SSEChunk) => void,
    files?: File[],
    signal?: AbortSignal,
): Promise<void> {
    const formData = new FormData();
    formData.append('payload', JSON.stringify({ messages }));

    if (files) {
        for (const file of files) {
            formData.append('files', file);
        }
    }

    const response = await fetch(`${API_BASE}/chat/message`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
        signal,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const jsonStr = trimmed.slice(6);
            try {
                const chunk = JSON.parse(jsonStr) as SSEChunk;
                onChunk(chunk);
            } catch {
                // Skip malformed JSON
            }
        }
    }

    // Process any remaining buffer
    if (buffer.trim().startsWith('data: ')) {
        try {
            const chunk = JSON.parse(buffer.trim().slice(6)) as SSEChunk;
            onChunk(chunk);
        } catch {
            // Ignore
        }
    }
}

// ============================================
// CONFIRM ACTION
// ============================================

export interface ConfirmResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/**
 * Confirm a pending mutating action.
 */
export async function confirmAction(
    actionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
): Promise<ConfirmResult> {
    const response = await fetch(`${API_BASE}/chat/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify({ actionId, toolName, toolInput }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
    }

    return response.json();
}
