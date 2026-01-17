/**
 * EditDialogFooter - Save/Cancel/Back buttons for edit dialogs
 */

import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EditDialogFooterProps {
  onSave: () => void;
  onCancel: () => void;
  onBack?: () => void;
  canGoBack?: boolean;
  isSaving?: boolean;
  isDirty?: boolean;
  isValid?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
}

export function EditDialogFooter({
  onSave,
  onCancel,
  onBack,
  canGoBack = false,
  isSaving = false,
  isDirty = false,
  isValid = true,
  saveLabel = 'Save Changes',
  cancelLabel = 'Cancel',
}: EditDialogFooterProps) {
  return (
    <div className="flex items-center justify-between pt-4 border-t bg-gray-50 -mx-6 -mb-6 px-6 py-4 rounded-b-lg">
      {/* Left side - Back button */}
      <div>
        {canGoBack && onBack && (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isSaving}
            className="gap-1"
          >
            <ChevronLeft size={16} />
            Back
          </Button>
        )}
      </div>

      {/* Right side - Cancel and Save */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={isSaving || !isDirty || !isValid}
          className="gap-2"
        >
          {isSaving && <Loader2 size={16} className="animate-spin" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Unsaved changes indicator
 */
export function UnsavedIndicator({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600">
      <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Unsaved changes
    </div>
  );
}
