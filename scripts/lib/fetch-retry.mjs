/**
 * fetch-retry.mjs - fetch wrapper with exponential backoff.
 * Retries on network errors and 5xx responses. Does NOT retry 4xx.
 */

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ maxRetries?: number, baseDelay?: number }} retryOpts
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, { maxRetries = 3, baseDelay = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Success or client error (4xx) - don't retry
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      // Server error (5xx) - retry
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      // Network error - retry
      lastError = err;
    }
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}
