const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'page-cache');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

/**
 * Convert a URL to a safe, human-readable filename.
 * Strips the scheme+host, then replaces non-alphanumeric chars with underscores.
 */
function urlToFilename(url) {
  const slug = url
    .replace(/^https?:\/\/[^/]+/, '')  // strip scheme + host
    .replace(/[^a-zA-Z0-9-]/g, '_')    // sanitize
    .replace(/_+/g, '_')               // collapse runs
    .replace(/^_|_$/g, '');            // trim edges
  return (slug || 'index') + '.html';
}

/**
 * Return cached HTML for a URL, or null if not cached.
 */
async function get(url) {
  try {
    const file = path.join(CACHE_DIR, urlToFilename(url));
    return await fs.readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Store HTML for a URL.
 */
async function set(url, html) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, urlToFilename(url));
    await fs.writeFile(file, html, 'utf-8');
  } catch (error) {
    console.error(`  ⚠️  Page cache write failed for ${url}: ${error.message}`);
  }
}

/**
 * Fetch a URL, using the page cache when useCache is true.
 * When useCache is true:
 *   - Returns cached HTML if available (no network request).
 *   - Otherwise fetches, caches the response, and returns the HTML.
 * When useCache is false, behaves as a plain axios.get.
 */
async function fetchPage(url, useCache = false, axiosOptions = {}) {
  if (useCache) {
    const cached = await get(url);
    if (cached !== null) {
      return { html: cached, fromCache: true };
    }
  }

  const response = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 10000,
    ...axiosOptions
  });

  if (useCache) {
    await set(url, response.data);
  }

  return { html: response.data, fromCache: false };
}

module.exports = { get, set, fetchPage, urlToFilename, CACHE_DIR };
