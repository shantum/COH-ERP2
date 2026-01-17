/**
 * Cost Summary
 *
 * Sticky footer component showing real-time BOM cost breakdown.
 * Updates as user edits components in the BOM Editor.
 */

interface CostSummaryProps {
    fabricCost: number;
    trimCost: number;
    serviceCost: number;
    totalCogs: number;
}

export default function CostSummary({
    fabricCost,
    trimCost,
    serviceCost,
    totalCogs,
}: CostSummaryProps) {
    return (
        <div className="border-t bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
                {/* Cost Breakdown */}
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">Fabric:</span>
                        <span className="font-medium">₹{fabricCost.toFixed(2)}</span>
                    </div>
                    <div className="text-gray-300">|</div>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">Trims:</span>
                        <span className="font-medium">₹{trimCost.toFixed(2)}</span>
                    </div>
                    <div className="text-gray-300">|</div>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">Services:</span>
                        <span className="font-medium">₹{serviceCost.toFixed(2)}</span>
                    </div>
                </div>

                {/* Total */}
                <div className="flex items-center gap-2">
                    <span className="text-gray-600 font-medium">TOTAL:</span>
                    <span className="text-lg font-bold text-gray-900">₹{totalCogs.toFixed(2)}</span>
                </div>
            </div>

            {/* Percentage breakdown */}
            {totalCogs > 0 && (
                <div className="flex items-center gap-1 mt-2">
                    {fabricCost > 0 && (
                        <div
                            className="h-1.5 bg-blue-400 rounded-full"
                            style={{ width: `${(fabricCost / totalCogs) * 100}%` }}
                            title={`Fabric: ${((fabricCost / totalCogs) * 100).toFixed(1)}%`}
                        />
                    )}
                    {trimCost > 0 && (
                        <div
                            className="h-1.5 bg-amber-400 rounded-full"
                            style={{ width: `${(trimCost / totalCogs) * 100}%` }}
                            title={`Trims: ${((trimCost / totalCogs) * 100).toFixed(1)}%`}
                        />
                    )}
                    {serviceCost > 0 && (
                        <div
                            className="h-1.5 bg-purple-400 rounded-full"
                            style={{ width: `${(serviceCost / totalCogs) * 100}%` }}
                            title={`Services: ${((serviceCost / totalCogs) * 100).toFixed(1)}%`}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
