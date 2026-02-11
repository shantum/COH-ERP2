/**
 * ChatPanel — Main chat interface.
 * Shows message history, streams AI responses, handles file uploads,
 * and renders ActionCards for pending mutations.
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { X, Send, Paperclip, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { ActionCard } from './ActionCard';
import { streamMessage, type ChatMessagePayload, type SSEChunk } from './chatApi';

// ============================================
// TYPES
// ============================================

interface PendingAction {
    actionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    description: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    action?: PendingAction;
}

interface ChatPanelProps {
    onClose: () => void;
}

let messageCounter = 0;
function nextId(): string {
    return `msg-${++messageCounter}-${Date.now()}`;
}

// ============================================
// COMPONENT
// ============================================

export function ChatPanel({ onClose }: ChatPanelProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: nextId(), role: 'system', content: 'Hi! I can help you look up orders, check inventory, manage fabric stock, and more. What do you need?' },
    ]);
    const [input, setInput] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom
    const scrollToBottom = useCallback(() => {
        requestAnimationFrame(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // Focus textarea on mount
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed && files.length === 0) return;
        if (isStreaming) return;

        // Add user message
        const userMsg: ChatMessage = {
            id: nextId(),
            role: 'user',
            content: trimmed + (files.length > 0 ? ` [${files.length} file${files.length > 1 ? 's' : ''} attached]` : ''),
        };
        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        setInput('');
        const sentFiles = [...files];
        setFiles([]);

        // Build payload (exclude system messages)
        const payload: ChatMessagePayload[] = newMessages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        // Create a placeholder for the assistant response
        const assistantId = nextId();
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

        setIsStreaming(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            await streamMessage(
                payload,
                (chunk: SSEChunk) => {
                    switch (chunk.type) {
                        case 'text_delta':
                            setMessages(prev => prev.map(m =>
                                m.id === assistantId
                                    ? { ...m, content: m.content + chunk.text }
                                    : m,
                            ));
                            break;

                        case 'action_pending':
                            setMessages(prev => prev.map(m =>
                                m.id === assistantId
                                    ? { ...m, action: chunk }
                                    : m,
                            ));
                            break;

                        case 'error':
                            setMessages(prev => prev.map(m =>
                                m.id === assistantId
                                    ? { ...m, content: m.content + `\n\nError: ${chunk.message}` }
                                    : m,
                            ));
                            break;

                        case 'done':
                            // Clean up empty assistant messages
                            setMessages(prev => prev.map(m =>
                                m.id === assistantId && !m.content && !m.action
                                    ? { ...m, content: 'Done.' }
                                    : m,
                            ));
                            break;
                    }
                },
                sentFiles.length > 0 ? sentFiles : undefined,
                controller.signal,
            );
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') return;
            const errMsg = error instanceof Error ? error.message : 'Something went wrong';
            setMessages(prev => prev.map(m =>
                m.id === assistantId
                    ? { ...m, content: `Error: ${errMsg}` }
                    : m,
            ));
        } finally {
            setIsStreaming(false);
            abortRef.current = null;
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleFileSelect = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files;
        if (selected) {
            setFiles(prev => [...prev, ...Array.from(selected)]);
        }
        // Reset so same file can be selected again
        e.target.value = '';
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleActionResult = (message: string) => {
        setMessages(prev => [...prev, { id: nextId(), role: 'system', content: message }]);
    };

    const clearChat = () => {
        setMessages([
            { id: nextId(), role: 'system', content: 'Chat cleared. How can I help?' },
        ]);
    };

    return (
        <div className="fixed bottom-20 right-4 z-50 flex flex-col w-[400px] h-[560px] max-sm:w-[calc(100vw-2rem)] max-sm:h-[calc(100vh-6rem)] max-sm:bottom-4 max-sm:right-4 rounded-xl border border-gray-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 rounded-t-xl bg-gray-50">
                <div className="flex items-center gap-2">
                    <Sparkles size={18} className="text-violet-600" />
                    <span className="text-sm font-semibold text-gray-900">COH Assistant</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={clearChat}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                        title="Clear chat"
                    >
                        <Trash2 size={15} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {messages.map(msg => (
                    <div key={msg.id}>
                        {msg.role === 'user' ? (
                            <div className="flex justify-end">
                                <div className="max-w-[85%] rounded-lg bg-violet-600 px-3 py-2 text-sm text-white whitespace-pre-wrap">
                                    {msg.content}
                                </div>
                            </div>
                        ) : msg.role === 'system' ? (
                            <div className="flex justify-start">
                                <div className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
                                    {msg.content}
                                </div>
                            </div>
                        ) : (
                            <div className="flex justify-start">
                                <div className="max-w-[85%]">
                                    {msg.content && (
                                        <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">
                                            {msg.content}
                                            {isStreaming && messages[messages.length - 1]?.id === msg.id && (
                                                <span className="inline-block w-1.5 h-4 ml-0.5 bg-gray-400 animate-pulse rounded-sm" />
                                            )}
                                        </div>
                                    )}
                                    {msg.action && (
                                        <ActionCard action={msg.action} onResult={handleActionResult} />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* File preview */}
            {files.length > 0 && (
                <div className="px-3 py-2 border-t border-gray-100 flex gap-2 flex-wrap">
                    {files.map((f, i) => (
                        <div key={i} className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                            <span className="max-w-[120px] truncate">{f.name}</span>
                            <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-gray-600">
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Input area */}
            <div className="px-3 py-3 border-t border-gray-200">
                <div className="flex items-end gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                        multiple
                        onChange={handleFileChange}
                    />
                    <button
                        onClick={handleFileSelect}
                        className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                        title="Attach file"
                        disabled={isStreaming}
                    >
                        <Paperclip size={18} />
                    </button>
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about orders, inventory, fabrics..."
                        className="flex-1 min-h-[40px] max-h-[100px] resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-50"
                        rows={1}
                        disabled={isStreaming}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isStreaming || (!input.trim() && files.length === 0)}
                        className="flex-shrink-0 p-2 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {isStreaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
