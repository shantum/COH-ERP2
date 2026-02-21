/**
 * CostInheritanceField - Cost field with inherit/override toggle
 *
 * Shows inherited value with source indication.
 * Toggle allows override with custom value.
 */

import { Controller, type Control } from 'react-hook-form';
import { ArrowUp } from 'lucide-react';
// Types defined locally since cost cascade was removed from the shared types
type CostSource = 'sku' | 'variation' | 'product' | 'default' | 'none';

interface CostCascadeValue {
  effectiveValue: number | null;
  source: CostSource;
  skuValue: number | null;
  variationValue: number | null;
  productValue: number | null;
  defaultValue: number | null;
}

interface CostInheritanceFieldProps {
  name: string;
  label: string;
  control: Control<any>;
  cascade: CostCascadeValue;
  unit?: string;
  step?: string;
  placeholder?: string;
  level: 'product' | 'variation' | 'sku';
  disabled?: boolean;
}

const SOURCE_LABELS: Record<CostSource, string> = {
  sku: 'SKU override',
  variation: 'from variation',
  product: 'from product',
  default: 'default',
  none: 'not set',
};

const SOURCE_COLORS: Record<CostSource, string> = {
  sku: 'text-blue-600',
  variation: 'text-purple-600',
  product: 'text-indigo-600',
  default: 'text-gray-500',
  none: 'text-gray-400',
};

export function CostInheritanceField({
  name,
  label,
  control,
  cascade,
  unit = '',
  step = '0.01',
  placeholder,
  level,
  disabled = false,
}: CostInheritanceFieldProps) {
  // Determine what levels can be inherited from
  const canInherit = level !== 'product';
  const inheritedValue = cascade.effectiveValue;
  const inheritedSource = cascade.source;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const hasOverride = field.value !== null && field.value !== undefined && field.value !== '';

        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                {label}
              </label>
              {canInherit && !hasOverride && inheritedValue !== null && (
                <span className={`text-xs ${SOURCE_COLORS[inheritedSource]}`}>
                  {SOURCE_LABELS[inheritedSource]}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Main input */}
              <div className="relative flex-1">
                {unit && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    {unit}
                  </span>
                )}
                <input
                  type="number"
                  step={step}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.onChange(val === '' ? null : parseFloat(val));
                  }}
                  onBlur={field.onBlur}
                  placeholder={
                    placeholder ||
                    (canInherit && inheritedValue !== null
                      ? `${inheritedValue} (inherited)`
                      : 'Enter value')
                  }
                  disabled={disabled}
                  className={`
                    w-full px-3 py-2 border rounded-lg text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                    disabled:bg-gray-50 disabled:text-gray-500
                    ${unit ? 'pl-8' : ''}
                    ${error ? 'border-red-300' : 'border-gray-300'}
                    ${!hasOverride && canInherit ? 'bg-gray-50 text-gray-500 italic' : 'bg-white'}
                  `}
                />
              </div>

              {/* Inherit button (clear override) */}
              {canInherit && hasOverride && (
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  disabled={disabled}
                  className="flex items-center gap-1 px-2 py-2 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Clear override and inherit from parent"
                >
                  <ArrowUp size={14} />
                  <span>Inherit</span>
                </button>
              )}
            </div>

            {/* Effective value display when inherited */}
            {canInherit && !hasOverride && inheritedValue !== null && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <span>Effective:</span>
                <span className="font-medium">
                  {unit}{inheritedValue}
                </span>
              </div>
            )}

            {/* Error message */}
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
 * Simplified cost field without inheritance (for Product level)
 */
export function SimpleCostField({
  name,
  label,
  control,
  defaultValue,
  unit = '',
  step = '0.01',
  placeholder,
  disabled = false,
}: {
  name: string;
  label: string;
  control: Control<any>;
  defaultValue?: number | null;
  unit?: string;
  step?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              {label}
            </label>
            {defaultValue !== null && defaultValue !== undefined && (
              <span className="text-xs text-gray-500">
                Default: {unit}{defaultValue}
              </span>
            )}
          </div>

          <div className="relative">
            {unit && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                {unit}
              </span>
            )}
            <input
              type="number"
              step={step}
              value={field.value ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                field.onChange(val === '' ? null : parseFloat(val));
              }}
              onBlur={field.onBlur}
              placeholder={placeholder || `Enter ${label.toLowerCase()}`}
              disabled={disabled}
              className={`
                w-full px-3 py-2 border rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500
                disabled:bg-gray-50 disabled:text-gray-500
                ${unit ? 'pl-8' : ''}
                ${error ? 'border-red-300' : 'border-gray-300'}
              `}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error.message}</p>
          )}
        </div>
      )}
    />
  );
}
