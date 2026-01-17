/**
 * AddBomLineModal - Modal for adding new BOM lines
 *
 * Flow:
 * 1. Select type (Fabric/Trim/Service) via cards
 * 2. Select role from filtered dropdown
 * 3. Select component (optional for fabrics at product level)
 * 4. Enter quantity
 * 5. Submit
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scissors, Package, Wrench, Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { bomApi } from '@/services/api';
import type { AddBomLineModalProps, BomComponentType, ComponentRole } from './types';

const TYPE_CARDS: Array<{
    type: BomComponentType;
    label: string;
    description: string;
    icon: React.ComponentType<{ size: number; className?: string }>;
    color: string;
    bgColor: string;
    borderColor: string;
}> = [
    {
        type: 'FABRIC',
        label: 'Fabric',
        description: 'Main fabric, lining, contrast',
        icon: Scissors,
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-300',
    },
    {
        type: 'TRIM',
        label: 'Trim',
        description: 'Buttons, zippers, labels',
        icon: Package,
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-300',
    },
    {
        type: 'SERVICE',
        label: 'Service',
        description: 'Printing, embroidery, washing',
        icon: Wrench,
        color: 'text-teal-600',
        bgColor: 'bg-teal-50',
        borderColor: 'border-teal-300',
    },
];

export function AddBomLineModal({
    isOpen,
    onClose,
    onAdd,
    existingRoles,
    context,
}: AddBomLineModalProps) {
    const [step, setStep] = useState<'type' | 'details'>('type');
    const [selectedType, setSelectedType] = useState<BomComponentType | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState<string>('');
    const [selectedComponentId, setSelectedComponentId] = useState<string>('');
    const [quantity, setQuantity] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch component roles
    const { data: allRoles = [], isLoading: rolesLoading } = useQuery({
        queryKey: ['componentRoles'],
        queryFn: () => bomApi.getComponentRoles().then((r) => r.data),
        staleTime: 60 * 60 * 1000,
    });

    // Fetch available components
    const { data: availableComponents, isLoading: componentsLoading } = useQuery({
        queryKey: ['availableComponents'],
        queryFn: () => bomApi.getAvailableComponents().then((r) => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Filter roles by selected type and exclude already-used roles
    const filteredRoles = useMemo(() => {
        if (!selectedType || !allRoles.length) return [];
        return (allRoles as ComponentRole[]).filter(
            (role) =>
                role.type.code === selectedType && !existingRoles.includes(role.id)
        );
    }, [selectedType, allRoles, existingRoles]);

    // Get components for selected type
    const components = useMemo(() => {
        if (!availableComponents || !selectedType) return [];
        switch (selectedType) {
            case 'FABRIC':
                return availableComponents.fabrics || [];
            case 'TRIM':
                return availableComponents.trims || [];
            case 'SERVICE':
                return availableComponents.services || [];
            default:
                return [];
        }
    }, [availableComponents, selectedType]);

    // Reset state when modal closes
    const handleClose = () => {
        setStep('type');
        setSelectedType(null);
        setSelectedRoleId('');
        setSelectedComponentId('');
        setQuantity('');
        setIsSubmitting(false);
        onClose();
    };

    // Handle type selection
    const handleTypeSelect = (type: BomComponentType) => {
        setSelectedType(type);
        setSelectedRoleId('');
        setSelectedComponentId('');
        setStep('details');
    };

    // Handle form submission
    const handleSubmit = async () => {
        if (!selectedRoleId || !selectedType) return;

        setIsSubmitting(true);
        try {
            await onAdd({
                roleId: selectedRoleId,
                componentType: selectedType,
                componentId: selectedComponentId || undefined,
                quantity: quantity ? parseFloat(quantity) : undefined,
            });
            handleClose();
        } catch (error) {
            console.error('Failed to add BOM line:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const canSubmit =
        selectedRoleId &&
        selectedType &&
        // For product-level fabrics, component is optional ("Per variation")
        (selectedType === 'FABRIC' && context === 'product'
            ? true
            : selectedComponentId);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {step === 'type' ? 'Add BOM Line' : `Add ${selectedType} Line`}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'type'
                            ? 'Select the type of component to add'
                            : 'Configure the component details'}
                    </DialogDescription>
                </DialogHeader>

                {step === 'type' ? (
                    /* Type Selection */
                    <div className="grid grid-cols-3 gap-3 py-4">
                        {TYPE_CARDS.map((card) => {
                            const Icon = card.icon;
                            const hasAvailableRoles = (allRoles as ComponentRole[]).some(
                                (r) => r.type.code === card.type && !existingRoles.includes(r.id)
                            );
                            return (
                                <button
                                    key={card.type}
                                    onClick={() => handleTypeSelect(card.type)}
                                    disabled={!hasAvailableRoles || rolesLoading}
                                    className={`
                                        flex flex-col items-center p-4 rounded-lg border-2 transition-all
                                        ${hasAvailableRoles
                                            ? `${card.bgColor} ${card.borderColor} hover:shadow-md cursor-pointer`
                                            : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                                        }
                                    `}
                                >
                                    <Icon size={24} className={hasAvailableRoles ? card.color : 'text-gray-400'} />
                                    <span className={`mt-2 font-medium text-sm ${hasAvailableRoles ? card.color : 'text-gray-400'}`}>
                                        {card.label}
                                    </span>
                                    <span className="mt-1 text-[10px] text-gray-500 text-center">
                                        {card.description}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    /* Details Form */
                    <div className="space-y-4 py-4">
                        {/* Role Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Role <span className="text-red-500">*</span>
                            </label>
                            <Select
                                value={selectedRoleId}
                                onValueChange={setSelectedRoleId}
                                disabled={rolesLoading}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select role..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredRoles.map((role) => (
                                        <SelectItem key={role.id} value={role.id}>
                                            {role.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {filteredRoles.length === 0 && !rolesLoading && (
                                <p className="text-xs text-amber-600">
                                    All roles of this type are already in use
                                </p>
                            )}
                        </div>

                        {/* Component Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Component
                                {selectedType !== 'FABRIC' || context === 'variation' ? (
                                    <span className="text-red-500"> *</span>
                                ) : (
                                    <span className="text-gray-400 font-normal ml-1">(optional)</span>
                                )}
                            </label>
                            <Select
                                value={selectedComponentId}
                                onValueChange={setSelectedComponentId}
                                disabled={componentsLoading}
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={
                                            selectedType === 'FABRIC' && context === 'product'
                                                ? 'Per variation (default)'
                                                : 'Select component...'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {selectedType === 'FABRIC' && context === 'product' && (
                                        <SelectItem value="">
                                            <span className="italic text-purple-600">Per variation</span>
                                        </SelectItem>
                                    )}
                                    {components.map((comp: any) => (
                                        <SelectItem key={comp.id} value={comp.id}>
                                            <div className="flex items-center gap-2">
                                                {comp.colourHex && (
                                                    <span
                                                        className="w-3 h-3 rounded-full border border-gray-200"
                                                        style={{ backgroundColor: comp.colourHex }}
                                                    />
                                                )}
                                                {comp.name}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedType === 'FABRIC' && context === 'product' && (
                                <p className="text-xs text-gray-500">
                                    Leave empty to assign fabric at variation level
                                </p>
                            )}
                        </div>

                        {/* Quantity Input */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Default Quantity
                                <span className="text-gray-400 font-normal ml-1">(optional)</span>
                            </label>
                            <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                placeholder="e.g., 1.5"
                            />
                            <p className="text-xs text-gray-500">
                                {selectedType === 'FABRIC'
                                    ? 'Meters per unit'
                                    : selectedType === 'SERVICE'
                                    ? 'Jobs per unit'
                                    : 'Pieces per unit'}
                            </p>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    {step === 'details' && (
                        <Button
                            variant="outline"
                            onClick={() => setStep('type')}
                            disabled={isSubmitting}
                        >
                            Back
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    {step === 'details' && (
                        <Button
                            onClick={handleSubmit}
                            disabled={!canSubmit || isSubmitting}
                        >
                            {isSubmitting && <Loader2 size={14} className="animate-spin mr-1" />}
                            Add Line
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
