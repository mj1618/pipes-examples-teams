// In-memory store for URL shortener mappings
const store = new Map();

/**
 * Save a URL mapping with the given short code
 * @param {string} code - The short code
 * @param {string} url - The original URL
 */
export function saveUrl(code, url) {
  store.set(code, { url, visits: 0 });
}

/**
 * Get the URL mapping for a given short code
 * @param {string} code - The short code
 * @returns {{ url: string, visits: number } | undefined}
 */
export function getUrl(code) {
  return store.get(code);
}

/**
 * Increment the visit count for a given short code
 * @param {string} code - The short code
 */
export function incrementVisits(code) {
  const entry = store.get(code);
  if (entry) {
    entry.visits += 1;
  }
}

/**
 * Clear all entries (useful for testing)
 */
export function clearStore() {
  store.clear();
}
