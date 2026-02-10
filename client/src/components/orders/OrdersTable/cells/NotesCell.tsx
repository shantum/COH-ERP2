/**
 * NotesCell - Read-only display of line notes
 */
import { memo, useRef, useState, useEffect } from 'react';
import { FileText, ChevronDown } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface NotesCellProps {
    row: FlattenedOrderRow;
}

export const NotesCell = memo(function NotesCell({ row }: NotesCellProps) {
    if (!row?.lineId) return null;

    const notes = row.lineNotes;
    const [isExpanded, setIsExpanded] = useState(false);
    const [isTruncated, setIsTruncated] = useState(false);
    const textRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (textRef.current && !isExpanded) {
            const el = textRef.current;
            setIsTruncated(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
        }
    }, [notes, isExpanded]);

    // Collapse when clicking outside
    useEffect(() => {
        if (!isExpanded) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-notes-cell]')) {
                setIsExpanded(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isExpanded]);

    if (!notes) {
        return <span className="text-gray-400 text-[11px]">-</span>;
    }

    return (
        <div
            data-notes-cell
            className={cn('relative', isExpanded && 'z-10')}
        >
            <div
                onClick={() => isTruncated && setIsExpanded(!isExpanded)}
                className={cn(
                    'flex items-start gap-1.5 text-yellow-700 bg-yellow-50 px-1.5 py-1 rounded text-xs border border-yellow-200',
                    isTruncated && !isExpanded && 'cursor-pointer',
                    isExpanded
                        ? 'absolute left-0 top-0 min-w-[200px] max-w-[300px] shadow-lg border-yellow-300 bg-yellow-50/95 backdrop-blur-sm'
                        : 'max-w-full'
                )}
                title={isTruncated && !isExpanded ? 'Click to expand' : undefined}
            >
                <FileText size={12} className="shrink-0 mt-0.5 text-yellow-600" />
                <span
                    ref={textRef}
                    className={cn(
                        'whitespace-pre-wrap break-words',
                        !isExpanded && 'line-clamp-2'
                    )}
                >
                    {notes}
                </span>
                {!isExpanded && isTruncated && (
                    <ChevronDown size={12} className="shrink-0 mt-0.5 text-yellow-500" />
                )}
            </div>
        </div>
    );
});
