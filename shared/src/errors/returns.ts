/**
 * Returns Error Utilities
 *
 * Error codes, user-friendly messages, and ReturnError class for the returns domain.
 * Follows the result-based pattern used by inventory/orders for consistency.
 */

// ============================================
// ERROR CODES
// ============================================

/**
 * Error codes specific to the returns domain
 */
export const RETURN_ERROR_CODES = {
  // Eligibility
  NOT_DELIVERED: 'RETURN_NOT_DELIVERED',
  ALREADY_ACTIVE: 'RETURN_ALREADY_ACTIVE',
  LINE_NON_RETURNABLE: 'RETURN_LINE_NON_RETURNABLE',
  PRODUCT_NON_RETURNABLE: 'RETURN_PRODUCT_NON_RETURNABLE',
  WINDOW_EXPIRED: 'RETURN_WINDOW_EXPIRED',

  // Validation
  INVALID_QUANTITY: 'RETURN_INVALID_QUANTITY',
  INVALID_TRANSITION: 'RETURN_INVALID_TRANSITION',
  EXCHANGE_SKU_NOT_FOUND: 'RETURN_EXCHANGE_SKU_NOT_FOUND',
  REFUND_NOT_CALCULATED: 'RETURN_REFUND_NOT_CALCULATED',
  REFUND_NOT_COMPLETED: 'RETURN_REFUND_NOT_COMPLETED',
  REFUND_FAILED: 'RETURN_REFUND_FAILED',
  EXCHANGE_NOT_CREATED: 'RETURN_EXCHANGE_NOT_CREATED',
  NOT_REFUND_RESOLUTION: 'RETURN_NOT_REFUND_RESOLUTION',
  EXCHANGE_ALREADY_CREATED: 'RETURN_EXCHANGE_ALREADY_CREATED',
  NO_ACTIVE_RETURN: 'RETURN_NO_ACTIVE_RETURN',

  // State
  LINE_NOT_FOUND: 'RETURN_LINE_NOT_FOUND',
  ORDER_NOT_FOUND: 'RETURN_ORDER_NOT_FOUND',
  WRONG_STATUS: 'RETURN_WRONG_STATUS',
  ALREADY_TERMINAL: 'RETURN_ALREADY_TERMINAL',

  // General
  UNKNOWN: 'RETURN_UNKNOWN_ERROR',
} as const;

export type ReturnErrorCode = (typeof RETURN_ERROR_CODES)[keyof typeof RETURN_ERROR_CODES];

// ============================================
// USER-FRIENDLY MESSAGES
// ============================================

/**
 * User-friendly messages for each error code
 */
export const RETURN_ERROR_MESSAGES: Record<string, string> = {
  // Eligibility
  [RETURN_ERROR_CODES.NOT_DELIVERED]: 'This item has not been delivered yet',
  [RETURN_ERROR_CODES.ALREADY_ACTIVE]: 'This item already has an active return request',
  [RETURN_ERROR_CODES.LINE_NON_RETURNABLE]: 'This item is marked as non-returnable',
  [RETURN_ERROR_CODES.PRODUCT_NON_RETURNABLE]: 'This product type is not returnable',
  [RETURN_ERROR_CODES.WINDOW_EXPIRED]: 'The return window has expired',

  // Validation
  [RETURN_ERROR_CODES.INVALID_QUANTITY]: 'Return quantity exceeds available quantity',
  [RETURN_ERROR_CODES.INVALID_TRANSITION]: 'Cannot perform this action in current status',
  [RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND]: 'The selected exchange item was not found',
  [RETURN_ERROR_CODES.REFUND_NOT_CALCULATED]: 'Refund amount has not been calculated yet',
  [RETURN_ERROR_CODES.REFUND_NOT_COMPLETED]: 'Refund has not been completed yet',
  [RETURN_ERROR_CODES.REFUND_FAILED]: 'Refund processing failed',
  [RETURN_ERROR_CODES.EXCHANGE_NOT_CREATED]: 'Exchange order has not been created yet',
  [RETURN_ERROR_CODES.NOT_REFUND_RESOLUTION]: 'This return is not marked for refund',
  [RETURN_ERROR_CODES.EXCHANGE_ALREADY_CREATED]: 'An exchange order has already been created for this return',
  [RETURN_ERROR_CODES.NO_ACTIVE_RETURN]: 'This item does not have an active return',

  // State
  [RETURN_ERROR_CODES.LINE_NOT_FOUND]: 'Order line not found',
  [RETURN_ERROR_CODES.ORDER_NOT_FOUND]: 'Order not found',
  [RETURN_ERROR_CODES.WRONG_STATUS]: 'Return is not in the correct status for this action',
  [RETURN_ERROR_CODES.ALREADY_TERMINAL]: 'This return has already been completed or cancelled',

  // General
  [RETURN_ERROR_CODES.UNKNOWN]: 'An unexpected error occurred',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get user-friendly message for an error code
 */
export function getReturnErrorMessage(code: string, fallback?: string): string {
  return RETURN_ERROR_MESSAGES[code] || fallback || 'An error occurred';
}

/**
 * Check if an error code is a returns-specific code
 */
export function isReturnErrorCode(code: unknown): code is ReturnErrorCode {
  return (
    typeof code === 'string' &&
    Object.values(RETURN_ERROR_CODES).includes(code as ReturnErrorCode)
  );
}

// ============================================
// RETURN ERROR CLASS
// ============================================

/**
 * Structured error for returns domain
 * Includes both a technical message (for logs) and user-friendly message (for UI)
 */
export class ReturnError extends Error {
  readonly code: ReturnErrorCode;
  readonly userMessage: string;
  readonly context?: Record<string, unknown>;

  constructor(
    code: ReturnErrorCode,
    options?: {
      technicalMessage?: string;
      context?: Record<string, unknown>;
    }
  ) {
    const userMessage = getReturnErrorMessage(code);
    super(options?.technicalMessage || userMessage);
    this.name = 'ReturnError';
    this.code = code;
    this.userMessage = userMessage;
    this.context = options?.context;
    Object.setPrototypeOf(this, ReturnError.prototype);
  }

  /**
   * Convert to result object for server function responses
   */
  toResult(): ReturnErrorResult {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.userMessage,
      },
    };
  }
}

// ============================================
// RESULT TYPES
// ============================================

/**
 * Error result type for server function responses
 */
export interface ReturnErrorResult {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/**
 * Success result type for server function responses
 */
export interface ReturnSuccessResult<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

/**
 * Combined result type
 */
export type ReturnResult<T = unknown> = ReturnSuccessResult<T> | ReturnErrorResult;

// ============================================
// RESULT HELPERS
// ============================================

/**
 * Create a success result
 */
export function returnSuccess<T>(data?: T, message?: string): ReturnSuccessResult<T> {
  return { success: true, data, message };
}

/**
 * Create an error result from a code
 */
export function returnError(code: ReturnErrorCode, message?: string): ReturnErrorResult {
  return {
    success: false,
    error: {
      code,
      message: message || getReturnErrorMessage(code),
    },
  };
}

/**
 * Check if a result is an error
 */
export function isReturnError(result: ReturnResult): result is ReturnErrorResult {
  return result.success === false;
}
