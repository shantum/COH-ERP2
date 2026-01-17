/**
 * VariationInfoTab - Basic variation information editing
 */

import { Controller, type UseFormReturn } from 'react-hook-form';
import type { VariationFormData } from '../types';

interface VariationInfoTabProps {
  form: UseFormReturn<VariationFormData>;
  disabled?: boolean;
}

export function VariationInfoTab({ form, disabled = false }: VariationInfoTabProps) {
  const { control, formState: { errors }, watch, setValue } = form;
  const colorHex = watch('colorHex');

  return (
    <div className="space-y-4">
      {/* Color Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Color Name <span className="text-red-500">*</span>
        </label>
        <Controller
          name="colorName"
          control={control}
          rules={{ required: 'Color name is required' }}
          render={({ field }) => (
            <input
              {...field}
              type="text"
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g., Maroon, Navy Blue"
            />
          )}
        />
        {errors.colorName && (
          <p className="mt-1 text-xs text-red-600">{errors.colorName.message}</p>
        )}
      </div>

      {/* Color Hex */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Color Hex
        </label>
        <div className="flex gap-2">
          <Controller
            name="colorHex"
            control={control}
            render={({ field }) => (
              <>
                <input
                  type="color"
                  value={field.value || '#808080'}
                  onChange={(e) => field.onChange(e.target.value)}
                  disabled={disabled}
                  className="h-10 w-12 p-1 border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
                />
                <input
                  {...field}
                  value={field.value ?? ''}
                  type="text"
                  disabled={disabled}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                  placeholder="#808080"
                />
              </>
            )}
          />
        </div>
      </div>

      {/* Has Lining */}
      <div className="flex items-center gap-2">
        <Controller
          name="hasLining"
          control={control}
          render={({ field }) => (
            <input
              type="checkbox"
              checked={field.value}
              onChange={field.onChange}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
          )}
        />
        <label className="text-sm text-gray-700">Has Lining</label>
      </div>

      {/* Active Status */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <input
              type="checkbox"
              checked={field.value}
              onChange={field.onChange}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
          )}
        />
        <label className="text-sm text-gray-700">Active</label>
      </div>
    </div>
  );
}
