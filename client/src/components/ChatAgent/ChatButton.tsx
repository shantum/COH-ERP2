/**
 * ChatButton — Floating action button that toggles the chat panel.
 * Fixed bottom-right corner, shown on all authenticated pages.
 */

import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { ChatPanel } from './ChatPanel';

export function ChatButton() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            {isOpen && <ChatPanel onClose={() => setIsOpen(false)} />}

            <button
                onClick={() => setIsOpen(prev => !prev)}
                className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg hover:bg-violet-700 transition-colors hover:shadow-xl"
                title={isOpen ? 'Close assistant' : 'Open assistant'}
            >
                {isOpen ? <X size={22} /> : <MessageCircle size={22} />}
            </button>
        </>
    );
}
