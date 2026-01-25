/**
 * Shared Error Utilities
 *
 * Export barrel for domain-specific error utilities.
 */

export {
  // Error codes
  RETURN_ERROR_CODES,
  type ReturnErrorCode,
  // Messages
  RETURN_ERROR_MESSAGES,
  getReturnErrorMessage,
  isReturnErrorCode,
  // Error class
  ReturnError,
  // Result types
  type ReturnErrorResult,
  type ReturnSuccessResult,
  type ReturnResult,
  // Result helpers
  returnSuccess,
  returnError,
  isReturnError,
} from './returns.js';
