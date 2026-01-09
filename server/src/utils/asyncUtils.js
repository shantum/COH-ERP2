/**
 * Async and Promise utility functions
 * Helpers for asynchronous operations and promise handling
 */

/**
 * Sleep for specified milliseconds
 * 
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>} Promise that resolves after delay
 * 
 * @example
 * await sleep(1000); // Wait 1 second
 * console.log('Done waiting');
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry async function with exponential backoff
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Function to determine if should retry (default: always)
 * @returns {Promise<any>} Result of function
 * 
 * @example
 * const data = await retry(
 *     () => fetch('https://api.example.com/data'),
 *     { maxRetries: 5, initialDelay: 500 }
 * );
 */
export async function retry(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        shouldRetry = () => true
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries || !shouldRetry(error)) {
                throw error;
            }

            await sleep(delay);
            delay = Math.min(delay * 2, maxDelay); // Exponential backoff
        }
    }

    throw lastError;
}

/**
 * Execute promises in batches with concurrency limit
 * 
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to execute for each item
 * @param {number} concurrency - Maximum concurrent executions (default: 5)
 * @returns {Promise<Array>} Array of results
 * 
 * @example
 * const userIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const users = await batchProcess(
 *     userIds,
 *     id => fetchUser(id),
 *     3 // Process 3 at a time
 * );
 */
export async function batchProcess(items, fn, concurrency = 5) {
    const results = [];
    const executing = [];

    for (const item of items) {
        const promise = Promise.resolve().then(() => fn(item));
        results.push(promise);

        if (concurrency <= items.length) {
            const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);

            if (executing.length >= concurrency) {
                await Promise.race(executing);
            }
        }
    }

    return Promise.all(results);
}

/**
 * Execute promises in chunks sequentially
 * 
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to execute for each item
 * @param {number} chunkSize - Size of each chunk (default: 10)
 * @returns {Promise<Array>} Array of results
 * 
 * @example
 * const orders = await chunkProcess(
 *     orderIds,
 *     id => processOrder(id),
 *     5 // Process 5 at a time, wait for each chunk
 * );
 */
export async function chunkProcess(items, fn, chunkSize = 10) {
    const results = [];

    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(fn));
        results.push(...chunkResults);
    }

    return results;
}

/**
 * Timeout a promise
 * 
 * @param {Promise} promise - Promise to timeout
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Error message (default: 'Operation timed out')
 * @returns {Promise<any>} Original promise or timeout error
 * 
 * @example
 * const data = await timeout(
 *     fetch('https://slow-api.com/data'),
 *     5000,
 *     'API request timed out'
 * );
 */
export async function timeout(promise, ms, message = 'Operation timed out') {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(message));
        }, ms);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Debounce async function
 * 
 * @param {Function} fn - Async function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 * 
 * @example
 * const debouncedSearch = debounce(async (query) => {
 *     return await searchAPI(query);
 * }, 300);
 * 
 * debouncedSearch('hello'); // Only executes after 300ms of no calls
 */
export function debounce(fn, delay) {
    let timeoutId;

    return function (...args) {
        clearTimeout(timeoutId);

        return new Promise((resolve, reject) => {
            timeoutId = setTimeout(async () => {
                try {
                    const result = await fn.apply(this, args);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            }, delay);
        });
    };
}

/**
 * Throttle async function
 * 
 * @param {Function} fn - Async function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} Throttled function
 * 
 * @example
 * const throttledUpdate = throttle(async (data) => {
 *     return await updateAPI(data);
 * }, 1000);
 * 
 * throttledUpdate(data); // Executes immediately
 * throttledUpdate(data); // Ignored if called within 1 second
 */
export function throttle(fn, limit) {
    let inThrottle;

    return async function (...args) {
        if (!inThrottle) {
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
            return await fn.apply(this, args);
        }
    };
}

/**
 * Memoize async function results
 * 
 * @param {Function} fn - Async function to memoize
 * @param {Function} keyFn - Function to generate cache key (default: JSON.stringify)
 * @returns {Function} Memoized function
 * 
 * @example
 * const memoizedFetch = memoize(async (userId) => {
 *     return await fetchUser(userId);
 * });
 * 
 * await memoizedFetch(1); // Fetches from API
 * await memoizedFetch(1); // Returns cached result
 */
export function memoize(fn, keyFn = (...args) => JSON.stringify(args)) {
    const cache = new Map();

    return async function (...args) {
        const key = keyFn(...args);

        if (cache.has(key)) {
            return cache.get(key);
        }

        const result = await fn.apply(this, args);
        cache.set(key, result);
        return result;
    };
}

/**
 * Execute function with rate limiting
 * 
 * @param {Function} fn - Async function to rate limit
 * @param {number} maxCalls - Maximum calls per period
 * @param {number} period - Period in milliseconds
 * @returns {Function} Rate limited function
 * 
 * @example
 * const limitedAPI = rateLimit(async (data) => {
 *     return await callAPI(data);
 * }, 10, 1000); // Max 10 calls per second
 */
export function rateLimit(fn, maxCalls, period) {
    const calls = [];

    return async function (...args) {
        const now = Date.now();
        const cutoff = now - period;

        // Remove old calls
        while (calls.length > 0 && calls[0] < cutoff) {
            calls.shift();
        }

        if (calls.length >= maxCalls) {
            const oldestCall = calls[0];
            const waitTime = period - (now - oldestCall);
            await sleep(waitTime);
            return this(...args); // Retry after waiting
        }

        calls.push(now);
        return await fn.apply(this, args);
    };
}

/**
 * Safely execute async function with error handling
 * 
 * @param {Function} fn - Async function to execute
 * @param {any} defaultValue - Default value on error
 * @returns {Promise<[error, result]>} Tuple of [error, result]
 * 
 * @example
 * const [error, user] = await safe(fetchUser(userId));
 * if (error) {
 *     console.error('Failed to fetch user:', error);
 *     return;
 * }
 * console.log('User:', user);
 */
export async function safe(promise, defaultValue = null) {
    try {
        const result = await promise;
        return [null, result];
    } catch (error) {
        return [error, defaultValue];
    }
}
