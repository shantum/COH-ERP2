/**
 * ShipOrderModal component
 * Simple modal for entering AWB and courier to ship an order
 */

import { X } from 'lucide-react';

interface ShipOrderModalProps {
    order: any;
    shipForm: { awbNumber: string; courier: string };
    onShipFormChange: (form: { awbNumber: string; courier: string }) => void;
    onShip: () => void;
    onClose: () => void;
    isShipping: boolean;
}

export function ShipOrderModal({
    order,
    shipForm,
    onShipFormChange,
    onShip,
    onClose,
    isShipping,
}: ShipOrderModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">Ship Order</h2>
                        <p className="text-sm text-gray-500">
                            {order.orderNumber} • {order.customerName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onShip();
                    }}
                    className="space-y-4"
                >
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">AWB Number</label>
                        <input
                            className="input text-sm"
                            placeholder="Enter AWB number"
                            value={shipForm.awbNumber}
                            onChange={(e) =>
                                onShipFormChange({ ...shipForm, awbNumber: e.target.value })
                            }
                            required
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Courier</label>
                        <input
                            className="input text-sm"
                            placeholder="Enter courier name"
                            value={shipForm.courier}
                            onChange={(e) =>
                                onShipFormChange({ ...shipForm, courier: e.target.value })
                            }
                            required
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary flex-1 text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary flex-1 text-sm"
                            disabled={isShipping}
                        >
                            {isShipping ? 'Shipping...' : 'Mark as Shipped'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default ShipOrderModal;
