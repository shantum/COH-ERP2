/**
 * FabricSelector - Combobox with color swatches
 *
 * Searchable dropdown for fabric colour selection with:
 * - Colour swatch preview
 * - Material → Fabric → Colour hierarchy display
 * - Filter by materialId
 */

import { useState, useMemo } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import type { FabricColour } from '../types';

interface FabricSelectorProps {
  name: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic form control type
  control: Control<any>;
  fabricColours: FabricColour[];
  materialId?: string | null;
  disabled?: boolean;
  placeholder?: string;
}

export function FabricSelector({
  name,
  label,
  control,
  fabricColours,
  materialId,
  disabled = false,
  placeholder = 'Select fabric colour...',
}: FabricSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Filter fabric colours by material and search
  const filteredFabricColours = useMemo(() => {
    let filtered = fabricColours;

    // Filter by material if specified
    if (materialId) {
      filtered = filtered.filter(fc => fc.materialId === materialId);
    }

    // Filter by search
    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(fc =>
        fc.name.toLowerCase().includes(query) ||
        fc.fabricName.toLowerCase().includes(query) ||
        fc.materialName.toLowerCase().includes(query) ||
        (fc.code && fc.code.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [fabricColours, materialId, search]);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const selectedFabricColour = fabricColours.find(fc => fc.id === field.value);

        return (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              {label}
            </label>

            <div className="relative">
              {/* Trigger button */}
              <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`
                  w-full flex items-center justify-between gap-2
                  px-3 py-2 border rounded-lg text-sm text-left
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  disabled:bg-gray-50 disabled:cursor-not-allowed
                  ${error ? 'border-red-300' : 'border-gray-300'}
                  ${isOpen ? 'ring-2 ring-blue-500' : ''}
                `}
              >
                {selectedFabricColour ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedFabricColour.hex && (
                      <div
                        className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                        style={{ backgroundColor: selectedFabricColour.hex }}
                      />
                    )}
                    <span className="truncate">
                      {selectedFabricColour.name}
                      {selectedFabricColour.code && (
                        <span className="ml-1 px-1 py-0.5 text-[10px] font-mono bg-gray-100 text-gray-500 rounded">
                          {selectedFabricColour.code}
                        </span>
                      )}
                      <span className="text-gray-500 text-xs ml-2">
                        {selectedFabricColour.materialName} → {selectedFabricColour.fabricName}
                      </span>
                    </span>
                  </div>
                ) : (
                  <span className="text-gray-400">{placeholder}</span>
                )}
                <ChevronsUpDown size={16} className="text-gray-400 flex-shrink-0" />
              </button>

              {/* Dropdown */}
              {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                  {/* Search input */}
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search materials, fabrics, colours..."
                        className="w-full pl-7 pr-7 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Options list */}
                  <div className="max-h-60 overflow-y-auto">
                    {filteredFabricColours.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-500 text-center">
                        No fabric colours found
                      </div>
                    ) : (
                      filteredFabricColours.map((fabricColour) => (
                        <button
                          key={fabricColour.id}
                          type="button"
                          onClick={() => {
                            field.onChange(fabricColour.id);
                            setIsOpen(false);
                            setSearch('');
                          }}
                          className={`
                            w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                            hover:bg-gray-50 transition-colors
                            ${field.value === fabricColour.id ? 'bg-blue-50' : ''}
                          `}
                        >
                          {fabricColour.hex && (
                            <div
                              className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                              style={{ backgroundColor: fabricColour.hex }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 truncate">
                              <span className="font-medium truncate">{fabricColour.name}</span>
                              {fabricColour.code && (
                                <span className="ml-1 px-1 py-0.5 text-[10px] font-mono bg-gray-100 text-gray-500 rounded flex-shrink-0">
                                  {fabricColour.code}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {fabricColour.materialName} → {fabricColour.fabricName}
                              {fabricColour.costPerUnit && (
                                <span> • ₹{fabricColour.costPerUnit}/m</span>
                              )}
                            </div>
                          </div>
                          {field.value === fabricColour.id && (
                            <Check size={16} className="text-blue-600 flex-shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>

                  {/* Clear button */}
                  {field.value && (
                    <div className="p-2 border-t">
                      <button
                        type="button"
                        onClick={() => {
                          field.onChange(null);
                          setIsOpen(false);
                          setSearch('');
                        }}
                        className="w-full px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        Clear selection
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Backdrop to close dropdown */}
              {isOpen && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => {
                    setIsOpen(false);
                    setSearch('');
                  }}
                />
              )}
            </div>

            {/* Cost display */}
            {selectedFabricColour?.costPerUnit && (
              <div className="text-xs text-gray-500">
                Cost: ₹{selectedFabricColour.costPerUnit}/meter
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600">{error.message}</p>
            )}
          </div>
        );
      }}
    />
  );
}

/**
 * Simple color swatch display
 */
export function ColorSwatch({
  color,
  size = 'md',
  className = '',
}: {
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (!color) return null;

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-6 h-6',
  };

  return (
    <div
      className={`rounded-full border border-gray-200 ${sizeClasses[size]} ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}
