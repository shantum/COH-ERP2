/**
 * FabricSelector - Combobox with color swatches
 *
 * Searchable dropdown for fabric selection with:
 * - Color swatch preview
 * - Fabric name + color name display
 * - Filter by fabricTypeId
 */

import { useState, useMemo } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import type { Fabric } from '../types';

interface FabricSelectorProps {
  name: string;
  label: string;
  control: Control<any>;
  fabrics: Fabric[];
  fabricTypeId?: string | null;
  disabled?: boolean;
  placeholder?: string;
}

export function FabricSelector({
  name,
  label,
  control,
  fabrics,
  fabricTypeId,
  disabled = false,
  placeholder = 'Select fabric...',
}: FabricSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Filter fabrics by type and search
  const filteredFabrics = useMemo(() => {
    let filtered = fabrics;

    // Filter by fabric type if specified
    if (fabricTypeId) {
      filtered = filtered.filter(f => f.fabricTypeId === fabricTypeId);
    }

    // Filter by search
    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(f =>
        f.name.toLowerCase().includes(query) ||
        f.colorName?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [fabrics, fabricTypeId, search]);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const selectedFabric = fabrics.find(f => f.id === field.value);

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
                {selectedFabric ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedFabric.colorHex && (
                      <div
                        className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                        style={{ backgroundColor: selectedFabric.colorHex }}
                      />
                    )}
                    <span className="truncate">
                      {selectedFabric.name}
                      {selectedFabric.colorName && (
                        <span className="text-gray-500"> - {selectedFabric.colorName}</span>
                      )}
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
                        placeholder="Search fabrics..."
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
                    {filteredFabrics.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-500 text-center">
                        No fabrics found
                      </div>
                    ) : (
                      filteredFabrics.map((fabric) => (
                        <button
                          key={fabric.id}
                          type="button"
                          onClick={() => {
                            field.onChange(fabric.id);
                            setIsOpen(false);
                            setSearch('');
                          }}
                          className={`
                            w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                            hover:bg-gray-50 transition-colors
                            ${field.value === fabric.id ? 'bg-blue-50' : ''}
                          `}
                        >
                          {fabric.colorHex && (
                            <div
                              className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                              style={{ backgroundColor: fabric.colorHex }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">
                              {fabric.name}
                            </div>
                            {fabric.colorName && (
                              <div className="text-xs text-gray-500 truncate">
                                {fabric.colorName}
                                {fabric.costPerUnit && (
                                  <span> - {fabric.costPerUnit}/m</span>
                                )}
                              </div>
                            )}
                          </div>
                          {field.value === fabric.id && (
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
            {selectedFabric?.costPerUnit && (
              <div className="text-xs text-gray-500">
                Cost: {selectedFabric.costPerUnit}/meter
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
