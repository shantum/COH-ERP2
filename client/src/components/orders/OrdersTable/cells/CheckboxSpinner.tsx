/**
 * CheckboxSpinner - Loading indicator for checkbox cells
 * Shows a spinning indicator with appropriate color
 */

import { cn } from '../../../../lib/utils';

interface CheckboxSpinnerProps {
    color?: 'purple' | 'teal' | 'blue' | 'green' | 'red' | 'gray';
    size?: 'sm' | 'md';
}

const colorClasses = {
    purple: 'border-purple-500 border-t-transparent',
    teal: 'border-teal-500 border-t-transparent',
    blue: 'border-blue-500 border-t-transparent',
    green: 'border-green-500 border-t-transparent',
    red: 'border-red-500 border-t-transparent',
    gray: 'border-gray-500 border-t-transparent',
};

export function CheckboxSpinner({ color = 'gray', size = 'sm' }: CheckboxSpinnerProps) {
    return (
        <div
            className={cn(
                'animate-spin rounded-full border-2',
                colorClasses[color],
                size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
            )}
        />
    );
}
