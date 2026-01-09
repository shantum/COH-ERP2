/**
 * Common array and object utility functions
 * Helpers for data manipulation and transformation
 */

/**
 * Group array of objects by a key
 * 
 * @param {Array} array - Array of objects to group
 * @param {string|Function} key - Key to group by (string or function)
 * @returns {Object} Object with grouped items
 * 
 * @example
 * const orders = [
 *     { id: 1, status: 'open' },
 *     { id: 2, status: 'shipped' },
 *     { id: 3, status: 'open' }
 * ];
 * groupBy(orders, 'status');
 * // { open: [{id:1...}, {id:3...}], shipped: [{id:2...}] }
 */
export function groupBy(array, key) {
    if (!Array.isArray(array)) return {};

    const keyFn = typeof key === 'function' ? key : (item) => item[key];

    return array.reduce((result, item) => {
        const groupKey = keyFn(item);
        if (!result[groupKey]) {
            result[groupKey] = [];
        }
        result[groupKey].push(item);
        return result;
    }, {});
}

/**
 * Create a map from array of objects by a key
 * 
 * @param {Array} array - Array of objects
 * @param {string|Function} key - Key to use for map (string or function)
 * @returns {Map} Map with key -> object
 * 
 * @example
 * const users = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }];
 * const userMap = keyBy(users, 'id');
 * userMap.get('1'); // { id: '1', name: 'Alice' }
 */
export function keyBy(array, key) {
    if (!Array.isArray(array)) return new Map();

    const keyFn = typeof key === 'function' ? key : (item) => item[key];

    return new Map(array.map(item => [keyFn(item), item]));
}

/**
 * Remove duplicate objects from array by key
 * 
 * @param {Array} array - Array of objects
 * @param {string|Function} key - Key to check uniqueness
 * @returns {Array} Array with duplicates removed
 * 
 * @example
 * const items = [
 *     { id: 1, name: 'A' },
 *     { id: 2, name: 'B' },
 *     { id: 1, name: 'C' }
 * ];
 * uniqueBy(items, 'id'); // [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
 */
export function uniqueBy(array, key) {
    if (!Array.isArray(array)) return [];

    const keyFn = typeof key === 'function' ? key : (item) => item[key];
    const seen = new Set();

    return array.filter(item => {
        const k = keyFn(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * Sum values in array by key
 * 
 * @param {Array} array - Array of objects
 * @param {string|Function} key - Key to sum (string or function)
 * @returns {number} Sum of values
 * 
 * @example
 * const orders = [
 *     { total: 100 },
 *     { total: 200 },
 *     { total: 50 }
 * ];
 * sumBy(orders, 'total'); // 350
 */
export function sumBy(array, key) {
    if (!Array.isArray(array)) return 0;

    const keyFn = typeof key === 'function' ? key : (item) => item[key];

    return array.reduce((sum, item) => {
        const value = keyFn(item);
        return sum + (typeof value === 'number' ? value : 0);
    }, 0);
}

/**
 * Chunk array into smaller arrays
 * 
 * @param {Array} array - Array to chunk
 * @param {number} size - Size of each chunk
 * @returns {Array} Array of chunks
 * 
 * @example
 * chunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]
 */
export function chunk(array, size) {
    if (!Array.isArray(array) || size <= 0) return [];

    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Pick specific keys from object
 * 
 * @param {Object} obj - Source object
 * @param {Array<string>} keys - Keys to pick
 * @returns {Object} New object with only specified keys
 * 
 * @example
 * const user = { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' };
 * pick(user, ['id', 'name', 'email']); // { id: 1, name: 'Alice', email: 'alice@example.com' }
 */
export function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return {};

    return keys.reduce((result, key) => {
        if (key in obj) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

/**
 * Omit specific keys from object
 * 
 * @param {Object} obj - Source object
 * @param {Array<string>} keys - Keys to omit
 * @returns {Object} New object without specified keys
 * 
 * @example
 * const user = { id: 1, name: 'Alice', password: 'secret' };
 * omit(user, ['password']); // { id: 1, name: 'Alice' }
 */
export function omit(obj, keys) {
    if (!obj || typeof obj !== 'object') return {};

    const keysToOmit = new Set(keys);
    return Object.keys(obj).reduce((result, key) => {
        if (!keysToOmit.has(key)) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

/**
 * Deep clone an object (simple implementation)
 * Note: Does not handle circular references or special objects
 * 
 * @param {any} obj - Object to clone
 * @returns {any} Cloned object
 * 
 * @example
 * const original = { a: 1, b: { c: 2 } };
 * const cloned = deepClone(original);
 * cloned.b.c = 3;
 * console.log(original.b.c); // 2 (unchanged)
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));

    return Object.keys(obj).reduce((result, key) => {
        result[key] = deepClone(obj[key]);
        return result;
    }, {});
}

/**
 * Check if object is empty
 * 
 * @param {Object} obj - Object to check
 * @returns {boolean} True if object has no own properties
 * 
 * @example
 * isEmpty({}); // true
 * isEmpty({ a: 1 }); // false
 */
export function isEmpty(obj) {
    if (!obj) return true;
    return Object.keys(obj).length === 0;
}

/**
 * Safely get nested property value
 * 
 * @param {Object} obj - Source object
 * @param {string} path - Dot-separated path (e.g., 'user.address.city')
 * @param {any} defaultValue - Default value if path not found
 * @returns {any} Value at path or default value
 * 
 * @example
 * const data = { user: { name: 'Alice', address: { city: 'NYC' } } };
 * get(data, 'user.address.city'); // 'NYC'
 * get(data, 'user.age', 25); // 25 (default)
 */
export function get(obj, path, defaultValue = undefined) {
    if (!obj || typeof obj !== 'object') return defaultValue;

    const keys = path.split('.');
    let result = obj;

    for (const key of keys) {
        if (result && typeof result === 'object' && key in result) {
            result = result[key];
        } else {
            return defaultValue;
        }
    }

    return result;
}
