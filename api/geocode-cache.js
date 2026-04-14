const fs = require('fs').promises;
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'geocode-cache.json');

/**
 * Load geocoding cache from disk
 */
async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Return empty cache if file doesn't exist
    return {
      lastUpdated: new Date().toISOString(),
      cacheVersion: 1,
      entries: {}
    };
  }
}

/**
 * Save cache to disk
 */
async function saveCache(cache) {
  try {
    const dataDir = path.dirname(CACHE_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    cache.lastUpdated = new Date().toISOString();
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving geocode cache:', error.message);
    return false;
  }
}

/**
 * Create cache key from address (normalized)
 */
function getCacheKey(address, district) {
  if (!address || !district) return null;
  // Normalize to lowercase and trim whitespace
  return `${address.trim().toLowerCase()}|${district.trim().toLowerCase()}`;
}

/**
 * Get cached coordinates for an address
 */
async function getCached(address, district) {
  const cache = await loadCache();
  const key = getCacheKey(address, district);

  if (!key) return null;
  return cache.entries[key] || null;
}

/**
 * Cache geocoding result
 */
async function setCached(address, district, latitude, longitude) {
  const cache = await loadCache();
  const key = getCacheKey(address, district);

  if (!key) return false;

  cache.entries[key] = {
    address,
    district,
    latitude,
    longitude,
    cachedAt: new Date().toISOString()
  };

  return await saveCache(cache);
}

/**
 * Get cache statistics
 */
async function getStats() {
  const cache = await loadCache();
  return {
    totalEntries: Object.keys(cache.entries).length,
    lastUpdated: cache.lastUpdated,
    cacheFile: CACHE_FILE
  };
}

/**
 * Clear cache (for testing)
 */
async function clearCache() {
  const emptyCache = {
    lastUpdated: new Date().toISOString(),
    cacheVersion: 1,
    entries: {}
  };
  return await saveCache(emptyCache);
}

module.exports = {
  loadCache,
  saveCache,
  getCached,
  setCached,
  getStats,
  clearCache,
  getCacheKey
};
