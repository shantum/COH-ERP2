/**
 * String utility functions
 * Common string manipulation and formatting helpers
 */

/**
 * Capitalize first letter of string
 * 
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 * 
 * @example
 * capitalize('hello'); // 'Hello'
 * capitalize('HELLO'); // 'HELLO'
 */
export function capitalize(str) {
    if (!str || typeof str !== 'string') return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert string to title case
 * 
 * @param {string} str - String to convert
 * @returns {string} Title cased string
 * 
 * @example
 * titleCase('hello world'); // 'Hello World'
 * titleCase('HELLO WORLD'); // 'Hello World'
 */
export function titleCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => capitalize(word))
        .join(' ');
}

/**
 * Convert string to camelCase
 * 
 * @param {string} str - String to convert
 * @returns {string} camelCase string
 * 
 * @example
 * camelCase('hello world'); // 'helloWorld'
 * camelCase('Hello-World'); // 'helloWorld'
 */
export function camelCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
        .replace(/^[A-Z]/, chr => chr.toLowerCase());
}

/**
 * Convert string to snake_case
 * 
 * @param {string} str - String to convert
 * @returns {string} snake_case string
 * 
 * @example
 * snakeCase('helloWorld'); // 'hello_world'
 * snakeCase('Hello World'); // 'hello_world'
 */
export function snakeCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/([A-Z])/g, '_$1')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_/, '')
        .toLowerCase();
}

/**
 * Convert string to kebab-case
 * 
 * @param {string} str - String to convert
 * @returns {string} kebab-case string
 * 
 * @example
 * kebabCase('helloWorld'); // 'hello-world'
 * kebabCase('Hello World'); // 'hello-world'
 */
export function kebabCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/([A-Z])/g, '-$1')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-/, '')
        .toLowerCase();
}

/**
 * Truncate string to specified length
 * 
 * @param {string} str - String to truncate
 * @param {number} length - Maximum length
 * @param {string} suffix - Suffix to add (default: '...')
 * @returns {string} Truncated string
 * 
 * @example
 * truncate('Hello World', 8); // 'Hello...'
 * truncate('Hello World', 8, '…'); // 'Hello W…'
 */
export function truncate(str, length, suffix = '...') {
    if (!str || typeof str !== 'string') return '';
    if (str.length <= length) return str;
    return str.slice(0, length - suffix.length) + suffix;
}

/**
 * Remove extra whitespace from string
 * 
 * @param {string} str - String to clean
 * @returns {string} Cleaned string
 * 
 * @example
 * cleanWhitespace('  hello   world  '); // 'hello world'
 */
export function cleanWhitespace(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/\s+/g, ' ').trim();
}

/**
 * Slugify string for URLs
 * 
 * @param {string} str - String to slugify
 * @returns {string} URL-safe slug
 * 
 * @example
 * slugify('Hello World!'); // 'hello-world'
 * slugify('Product #123'); // 'product-123'
 */
export function slugify(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Escape HTML special characters
 * 
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 * 
 * @example
 * escapeHtml('<script>alert("xss")</script>'); 
 * // '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
export function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
}

/**
 * Remove HTML tags from string
 * 
 * @param {string} str - String with HTML
 * @returns {string} String without HTML tags
 * 
 * @example
 * stripHtml('<p>Hello <strong>World</strong></p>'); // 'Hello World'
 */
export function stripHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '');
}

/**
 * Check if string contains substring (case-insensitive)
 * 
 * @param {string} str - String to search in
 * @param {string} search - String to search for
 * @returns {boolean} True if found
 * 
 * @example
 * containsIgnoreCase('Hello World', 'WORLD'); // true
 */
export function containsIgnoreCase(str, search) {
    if (!str || !search) return false;
    return str.toLowerCase().includes(search.toLowerCase());
}

/**
 * Generate random string
 * 
 * @param {number} length - Length of string
 * @param {string} chars - Characters to use (default: alphanumeric)
 * @returns {string} Random string
 * 
 * @example
 * randomString(8); // 'aB3xY9mK'
 * randomString(6, '0123456789'); // '482719'
 */
export function randomString(length, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Pad string to specified length
 * 
 * @param {string} str - String to pad
 * @param {number} length - Target length
 * @param {string} char - Character to pad with (default: ' ')
 * @param {string} side - Side to pad ('left', 'right', 'both')
 * @returns {string} Padded string
 * 
 * @example
 * pad('5', 3, '0', 'left'); // '005'
 * pad('Hello', 10, '-', 'right'); // 'Hello-----'
 */
export function pad(str, length, char = ' ', side = 'left') {
    if (!str) str = '';
    str = String(str);

    if (str.length >= length) return str;

    const padLength = length - str.length;
    const padding = char.repeat(Math.ceil(padLength / char.length)).slice(0, padLength);

    if (side === 'left') return padding + str;
    if (side === 'right') return str + padding;
    if (side === 'both') {
        const leftPad = padding.slice(0, Math.floor(padLength / 2));
        const rightPad = padding.slice(Math.floor(padLength / 2));
        return leftPad + str + rightPad;
    }

    return str;
}

/**
 * Extract numbers from string
 * 
 * @param {string} str - String to extract from
 * @returns {string} Numbers only
 * 
 * @example
 * extractNumbers('Order #12345'); // '12345'
 * extractNumbers('Price: $99.99'); // '99.99'
 */
export function extractNumbers(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[^0-9.]/g, '');
}

/**
 * Count words in string
 * 
 * @param {string} str - String to count
 * @returns {number} Word count
 * 
 * @example
 * wordCount('Hello world'); // 2
 * wordCount('  Hello   world  '); // 2
 */
export function wordCount(str) {
    if (!str || typeof str !== 'string') return 0;
    return str.trim().split(/\s+/).filter(word => word.length > 0).length;
}
