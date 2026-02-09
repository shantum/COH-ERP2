/**
 * CreateOrderModal - Dialog wrapper around CreateOrderForm
 */

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { CreateOrderForm, type CreateOrderData } from './CreateOrderForm';

interface CreateOrderModalProps {
    channels: Array<{ id: string; name: string }>;
    onCreate: (data: CreateOrderData) => void;
    onClose: () => void;
    isCreating: boolean;
}

export function CreateOrderModal({
    channels,
    onCreate,
    onClose,
    isCreating,
}: CreateOrderModalProps) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md p-0 gap-0 max-h-[85vh] flex flex-col overflow-hidden">
                <DialogHeader className="px-4 py-3 border-b shrink-0">
                    <DialogTitle className="text-base">New Order</DialogTitle>
                </DialogHeader>

                <CreateOrderForm
                    channels={channels}
                    onCreate={onCreate}
                    isCreating={isCreating}
                    onCancel={onClose}
                />
            </DialogContent>
        </Dialog>
    );
}

export default CreateOrderModal;
