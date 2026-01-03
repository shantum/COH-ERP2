/**
 * OrderDetailModal component
 * Displays order details with line items and shipping form
 */

import { X, Trash2 } from 'lucide-react';
import { parseCity } from '../../utils/orderHelpers';

interface OrderDetailModalProps {
    order: any;
    shipForm: { awbNumber: string; courier: string };
    onShipFormChange: (form: { awbNumber: string; courier: string }) => void;
    onShip: () => void;
    onDelete: () => void;
    onClose: () => void;
    isShipping: boolean;
    isDeleting: boolean;
}

export function OrderDetailModal({
    order,
    shipForm,
    onShipFormChange,
    onShip,
    onDelete,
    onClose,
    isShipping,
    isDeleting,
}: OrderDetailModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">{order.orderNumber}</h2>
                        <p className="text-sm text-gray-500">
                            {order.customerName} • {parseCity(order.shippingAddress)}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Order Lines */}
                <div className="border rounded-lg overflow-hidden mb-4">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="text-left py-2 px-3 font-medium text-gray-600">Item</th>
                                <th className="text-center py-2 px-3 font-medium text-gray-600">Qty</th>
                                <th className="text-right py-2 px-3 font-medium text-gray-600">Price</th>
                                <th className="text-right py-2 px-3 font-medium text-gray-600">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {order.orderLines?.map((line: any) => (
                                <tr key={line.id} className="border-t">
                                    <td className="py-2 px-3">
                                        <p className="font-medium">{line.sku?.skuCode}</p>
                                        <p className="text-xs text-gray-500">
                                            {line.sku?.variation?.product?.name} - {line.sku?.size}
                                        </p>
                                    </td>
                                    <td className="py-2 px-3 text-center">{line.qty}</td>
                                    <td className="py-2 px-3 text-right">
                                        ₹{Number(line.unitPrice).toLocaleString()}
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                        <span
                                            className={`text-xs px-2 py-0.5 rounded ${
                                                line.lineStatus === 'packed'
                                                    ? 'bg-green-100 text-green-700'
                                                    : line.lineStatus === 'picked'
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : line.lineStatus === 'allocated'
                                                    ? 'bg-purple-100 text-purple-700'
                                                    : 'bg-gray-100 text-gray-600'
                                            }`}
                                        >
                                            {line.lineStatus}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-between items-center text-sm mb-4">
                    <span className="text-gray-500">Total</span>
                    <span className="font-semibold">₹{Number(order.totalAmount).toLocaleString()}</span>
                </div>

                {/* Ship Form */}
                {order.fulfillmentStage === 'ready_to_ship' && order.status === 'open' && (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            onShip();
                        }}
                        className="border-t pt-4 space-y-3"
                    >
                        <p className="text-sm font-medium text-gray-700">Ship Order</p>
                        <div className="grid grid-cols-2 gap-3">
                            <input
                                className="input text-sm"
                                placeholder="AWB Number"
                                value={shipForm.awbNumber}
                                onChange={(e) =>
                                    onShipFormChange({ ...shipForm, awbNumber: e.target.value })
                                }
                                required
                            />
                            <input
                                className="input text-sm"
                                placeholder="Courier"
                                value={shipForm.courier}
                                onChange={(e) =>
                                    onShipFormChange({ ...shipForm, courier: e.target.value })
                                }
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            className="btn-primary w-full text-sm"
                            disabled={isShipping}
                        >
                            {isShipping ? 'Shipping...' : 'Mark as Shipped'}
                        </button>
                    </form>
                )}

                {order.status === 'shipped' && (
                    <div className="border-t pt-4">
                        <p className="text-sm text-gray-500">
                            Shipped via <span className="font-medium text-gray-700">{order.courier}</span>
                        </p>
                        <p className="text-sm text-gray-500">
                            AWB: <span className="font-medium text-gray-700">{order.awbNumber}</span>
                        </p>
                    </div>
                )}

                <div className="flex gap-2 mt-4">
                    <button onClick={onClose} className="btn-secondary flex-1 text-sm">
                        Close
                    </button>
                    {!order.shopifyOrderId && (
                        <button
                            onClick={() => {
                                if (confirm(`Delete order ${order.orderNumber}? This cannot be undone.`)) {
                                    onDelete();
                                }
                            }}
                            className="btn-secondary text-sm text-red-600 hover:bg-red-50 hover:border-red-200 flex items-center gap-1"
                            disabled={isDeleting}
                        >
                            <Trash2 size={14} />
                            {isDeleting ? 'Deleting...' : 'Delete'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default OrderDetailModal;
