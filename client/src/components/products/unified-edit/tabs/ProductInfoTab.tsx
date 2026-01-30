/**
 * ProductInfoTab - Basic product information editing
 */

import { Controller, type UseFormReturn } from 'react-hook-form';
import type { ProductFormData } from '../types';
import { PRODUCT_CATEGORIES, GENDERS } from '../../types';

interface ProductInfoTabProps {
  form: UseFormReturn<ProductFormData>;
  disabled?: boolean;
}

export function ProductInfoTab({ form, disabled = false }: ProductInfoTabProps) {
  const { control, formState: { errors } } = form;

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Product Name <span className="text-red-500">*</span>
        </label>
        <Controller
          name="name"
          control={control}
          rules={{ required: 'Name is required' }}
          render={({ field }) => (
            <input
              {...field}
              type="text"
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g., Kurti, Shirt"
            />
          )}
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      {/* Style Code */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Style Code
        </label>
        <Controller
          name="styleCode"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              value={field.value ?? ''}
              type="text"
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g., KR-001"
            />
          )}
        />
      </div>

      {/* Category & Product Type */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Category
          </label>
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <select
                {...field}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="">Select category...</option>
                {PRODUCT_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Product Type
          </label>
          <Controller
            name="productType"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                type="text"
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                placeholder="e.g., A-Line, Straight"
              />
            )}
          />
        </div>
      </div>

      {/* Gender */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Gender
        </label>
        <Controller
          name="gender"
          control={control}
          render={({ field }) => (
            <select
              {...field}
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            >
              {GENDERS.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        />
      </div>

      {/* Active Status */}
      <div className="flex items-center gap-2 pt-2">
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
