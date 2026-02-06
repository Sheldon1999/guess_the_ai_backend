/**
 * Response utilities for consistent API responses
 */

/**
 * Create a success response
 * @param {Object} data - Response data
 * @param {string} message - Optional success message
 * @returns {Object} Formatted success response
 */
export function success(data, message = null) {
  const response = { success: true, data };
  if (message) response.message = message;
  return response;
}

/**
 * Create an error response
 * @param {string} message - Error message
 * @param {string} code - Optional error code
 * @returns {Object} Formatted error response
 */
export function error(message, code = null) {
  const response = { success: false, message };
  if (code) response.code = code;
  return response;
}

/**
 * Create a validation error response
 * @param {string} message - Validation error message
 * @param {Object} details - Optional validation details
 * @returns {Object} Formatted validation error
 */
export function validationError(message, details = null) {
  const response = { success: false, message, code: 'VALIDATION_ERROR' };
  if (details) response.details = details;
  return response;
}

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {Object} data - Response data
 * @param {number} statusCode - HTTP status code (default 200)
 */
export function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json(success(data));
}

/**
 * Send error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default 400)
 * @param {string} code - Optional error code
 */
export function sendError(res, message, statusCode = 400, code = null) {
  return res.status(statusCode).json(error(message, code));
}

/**
 * Send validation error response
 * @param {Object} res - Express response object
 * @param {string} message - Validation error message
 * @param {Object} details - Optional validation details
 */
export function sendValidationError(res, message, details = null) {
  return res.status(400).json(validationError(message, details));
}

/**
 * Send not found response
 * @param {Object} res - Express response object
 * @param {string} resource - Name of resource not found
 */
export function sendNotFound(res, resource = 'Resource') {
  return res.status(404).json(error(`${resource} not found`, 'NOT_FOUND'));
}

/**
 * Send unauthorized response
 * @param {Object} res - Express response object
 * @param {string} message - Unauthorized message
 */
export function sendUnauthorized(res, message = 'Unauthorized') {
  return res.status(401).json(error(message, 'UNAUTHORIZED'));
}

/**
 * Send server error response
 * @param {Object} res - Express response object
 * @param {Error} err - Error object
 * @param {string} context - Error context for logging
 */
export function sendServerError(res, err, context = 'Unknown') {
  console.error(`[${context}] Server error:`, err);
  return res.status(500).json(error('Internal server error', 'SERVER_ERROR'));
}
