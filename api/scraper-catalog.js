const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const geocodeCache = require('./geocode-cache');

/**
 * Scraper for pool catalog (static data)
 * Runs monthly to get pool names, types, districts, URLs, amenities
 * Does NOT fetch individual pool detail pages (expensive)
 */

const BASE_URL = 'https://www.berlinerbaeder.de';
const DATA_FILE = path.join(__dirname, '..', 'data', 'pools-catalog.json');
const maxPages = 7; // 67 pools across 7 pages

/**
 * Extract pool type from text
 */
function extractPoolType(text) {
  const types = {
    'hallenbad': 'Hallenbad',
    'freibad': 'Freibad',
    'strandbad': 'Strandbad',
    'kombibad': 'Kombibad'
  };

  for (const [key, value] of Object.entries(types)) {
    if (text.toLowerCase().includes(key)) {
      return value;
    }
  }
  return 'Unknown';
}

/**
 * Extract district from text
 */
function extractDistrict(text) {
  const districts = [
    'Mitte', 'Friedrichshain-Kreuzberg', 'Pankow', 'Charlottenburg-Wilmersdorf',
    'Spandau', 'Steglitz-Zehlendorf', 'Tempelhof-Schöneberg', 'Neukölln',
    'Treptow-Köpenick', 'Marzahn-Hellersdorf', 'Lichtenberg', 'Reinickendorf'
  ];

  for (const district of districts) {
    if (text.toLowerCase().includes(district.toLowerCase())) {
      return district;
    }
  }
  return null;
}

/**
 * Extract amenities from element
 */
function extractAmenities($el) {
  const amenities = [];
  const text = $el.text().toLowerCase();

  const keywords = {
    '25m': '25m Pool',
    '50m': '50m Pool',
    'rutsche': 'Slide',
    'sauna': 'Sauna',
    'sprudel': 'Whirlpool',
    'kinderbecken': 'Kiddie Pool',
    'sprungturm': 'Diving Platform',
    'becken': 'Basin'
  };

  for (const [keyword, label] of Object.entries(keywords)) {
    if (text.includes(keyword)) {
      amenities.push(label);
    }
  }

  return amenities;
}

/**
 * Extract district from pool detail page
 */
/**
 * Extract address, PLZ, and district from pool detail page.
 * Pages contain consecutive lines: "{street address}" then "{PLZ} Berlin {District}".
 * Returns { address, plz, district } or null.
 */
function extractAddressFromDetail($) {
  const lines = $('body').text().split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^(1[0-4]\d{3})\s+Berlin\s+(.+)/i);
    if (match) {
      return {
        address: lines[i - 1],
        plz: match[1],
        district: match[2].trim()
      };
    }
  }
  return null;
}

/**
 * Geocode address using Nominatim (OpenStreetMap)
 * Queries Nominatim for uncached addresses (cache check is external)
 * Handles rate limiting with exponential backoff
 * Returns { latitude, longitude } or null on failure
 */
async function geocodeAddress(address, plz, retryCount = 0) {
  try {
    if (!address) return null;

    // Use PLZ for a precise Nominatim query
    const query = `${address}, ${plz} Berlin, Germany`;
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        limit: 1
      },
      headers: {
        'User-Agent': 'Berliner-Baeder-Bot/1.0 (Respects Nominatim ToS)'
      },
      timeout: 5000
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon)
      };
    }

    return null;
  } catch (error) {
    // Handle rate limiting (429) with exponential backoff
    if (error.response && error.response.status === 429) {
      if (retryCount < 3) {
        const backoffMs = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
        console.log(`  ⏱️  Rate limited. Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return geocodeAddress(address, plz, retryCount + 1);
      } else {
        console.log(`  ⚠️  Max retries exceeded for "${address}"`);
        return null;
      }
    }

    console.log(`  ⚠️  Geocoding failed for "${address}": ${error.message}`);
    return null;
  }
}

/**
 * Fetch all pools from the listing pages
 * Includes fetching districts from detail pages
 */
async function fetchPoolCatalog() {
  try {
    console.log('🏊 Starting pool catalog scrape...');
    const pools = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const pageUrl = page === 1 ? `${BASE_URL}/baeder` : `${BASE_URL}/baeder/page/${page}/`;
        console.log(`  📄 Fetching page ${page}...`);

        const response = await axios.get(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const poolElements = $('.bathlist_item');

        poolElements.each((index, element) => {
          const $el = $(element);

          // Find the h2 with pool name and link
          const $titleEl = $el.find('h2');
          const $link = $titleEl.find('a');
          const name = $titleEl.text().trim();
          const url = $link.attr('href') || '';

          const type = extractPoolType(name);
          const district = extractDistrict(name); // Try name first
          const amenities = extractAmenities($el);

          const pool = {
            id: pools.length,
            name,
            url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
            type,
            district,
            amenities
          };

          if (pool.name) {
            pools.push(pool);
          }
        });

        // Small delay between pages
        if (page < maxPages) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (pageError) {
        console.error(`  ❌ Error on page ${page}:`, pageError.message);
      }
    }

    // Fetch PLZ, district, and address from every detail page
    console.log(`\n🔍 Fetching PLZ and addresses from detail pages...`);
    let detailCount = 0;

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];

      try {
        const response = await axios.get(pool.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        });

        const $ = cheerio.load(response.data);

        const detail = extractAddressFromDetail($);
        if (detail) {
          pools[i].address = detail.address;
          pools[i].plz = detail.plz;
          pools[i].district = detail.district;
        }

        detailCount++;
        console.log(`  ✅ ${pool.name.substring(0, 35)} - PLZ: ${pools[i].plz || 'N/A'} District: ${pools[i].district || 'N/A'}`);
      } catch (error) {
        console.error(`  ❌ Error fetching details for ${pool.name}:`, error.message);
      }

      // Delay between detail page requests
      if (i < pools.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log(`\n✅ Found ${pools.length} pools`);
    console.log(`   📍 Detail pages fetched: ${detailCount}`);

    return pools;
  } catch (error) {
    console.error('❌ Error fetching catalog:', error.message);
    return [];
  }
}

/**
 * Load catalog from file
 */
async function loadCatalog() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    const catalog = JSON.parse(data);
    return catalog.pools || [];
  } catch (error) {
    console.error('❌ Error loading catalog:', error.message);
    return [];
  }
}

/**
 * Save catalog to file
 */
async function saveCatalog(pools) {
  try {
    const dataDir = path.dirname(DATA_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    const data = {
      lastUpdated: new Date().toISOString(),
      totalPools: pools.length,
      pools
    };

    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Saved ${pools.length} pools to catalog`);
    return true;
  } catch (error) {
    console.error('❌ Error saving catalog:', error.message);
    return false;
  }
}

/**
 * Geocode a catalog of pools
 */
async function geocodeCatalog(pools) {
  console.log(`\n🌍 Geocoding addresses (checking cache first)...`);
  let geocodedCount = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheNewEntries = 0;

  // Load cache once to avoid repeated disk reads
  const cache = await geocodeCache.loadCache();
  console.log(`   Cache has ${Object.keys(cache.entries).length} entries`);

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];

    if (!pool.address) {
      console.log(`  ⚠️  SKIP (no address)     ${pool.name}`);
      continue;
    }
    if (!pool.plz) {
      console.log(`  ⚠️  SKIP (no PLZ)         ${pool.name}`);
      continue;
    }

    const cacheKey = geocodeCache.getCacheKey(pool.address, pool.plz);
    const cachedEntry = cache.entries[cacheKey];

    let coords;
    if (cachedEntry) {
      if (cachedEntry.failed) {
        console.log(`  ✖️  FAIL (cached)         ${pool.name} — "${pool.address}, ${pool.plz}"`);
        continue;
      }
      coords = { latitude: cachedEntry.latitude, longitude: cachedEntry.longitude };
      cacheHits++;
    } else {
      coords = await geocodeAddress(pool.address, pool.plz);
      if (coords) {
        cacheMisses++;
        cache.entries[cacheKey] = {
          address: pool.address,
          plz: pool.plz,
          latitude: coords.latitude,
          longitude: coords.longitude,
          cachedAt: new Date().toISOString()
        };
      } else {
        cache.entries[cacheKey] = { failed: true, cachedAt: new Date().toISOString() };
        console.log(`  ✖️  FAIL (Nominatim)      ${pool.name} — "${pool.address}, ${pool.plz}"`);
      }
      cacheNewEntries++;

      if (i < pools.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    if (coords) {
      pools[i].latitude = coords.latitude;
      pools[i].longitude = coords.longitude;
      geocodedCount++;

      const cacheStatus = cachedEntry ? '📦' : '🌐';
      console.log(`  ${cacheStatus} ${pool.name.substring(0, 35)} -> ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)} ${cachedEntry ? '(cached)' : '(new)'}`);
    }
  }

  // Save updated cache if there were new entries (successes or failures)
  if (cacheNewEntries > 0) {
    await geocodeCache.saveCache(cache);
  }

  const missing = pools.filter(p => !p.latitude);
  console.log(`\n✅ Geocoding complete`);
  console.log(`   🌍 Geocoded: ${geocodedCount} (${cacheHits} cached, ${cacheMisses} new)`);
  if (missing.length > 0) {
    console.log(`   ⚠️  Not geocoded: ${missing.length}`);
    for (const p of missing) {
      const reason = !p.address ? 'no address' : !p.plz ? 'no PLZ' : 'Nominatim failed';
      console.log(`      - ${p.name}: ${reason}${p.address ? ` ("${p.address}, ${p.plz || '?'}")` : ''}`);
    }
  }

  return pools;
}

/**
 * Run catalog scraper
 */
async function run() {
  try {
    console.log('🔄 Starting pool catalog scrape cycle...\n');
    let pools = await fetchPoolCatalog();

    if (pools.length === 0) {
      return {
        success: false,
        error: 'No pools found'
      };
    }

    pools = await geocodeCatalog(pools);

    const saved = await saveCatalog(pools);

    if (!saved) {
      return {
        success: false,
        error: 'Failed to save catalog'
      };
    }

    console.log('\n=== CATALOG SCRAPE COMPLETE ===');
    console.log(`✅ Total pools: ${pools.length}`);
    console.log(`✅ File: ${DATA_FILE}\n`);

    return {
      success: true,
      totalPools: pools.length,
      pools
    };
  } catch (error) {
    console.error('Error in catalog scraper:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Run geocoding only on existing catalog
 */
async function runGeocodeOnly() {
  try {
    console.log('🔄 Starting geocoding-only cycle...\n');
    const pools = await loadCatalog();

    if (pools.length === 0) {
      return {
        success: false,
        error: 'No pools found in catalog'
      };
    }

    console.log(`✅ Loaded ${pools.length} pools from catalog`);

    const geocodedPools = await geocodeCatalog(pools);

    const saved = await saveCatalog(geocodedPools);

    if (!saved) {
      return {
        success: false,
        error: 'Failed to save catalog'
      };
    }

    console.log('\n=== GEOCODING COMPLETE ===');
    console.log(`✅ File: ${DATA_FILE}\n`);

    return {
      success: true,
      totalPools: geocodedPools.length
    };
  } catch (error) {
    console.error('Error in geocoding:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Re-fetch detail pages only for pools missing address or PLZ, then geocode
 */
async function runFillMissing() {
  try {
    console.log('🔄 Filling missing addresses...\n');
    const pools = await loadCatalog();

    if (pools.length === 0) {
      return { success: false, error: 'No pools found in catalog' };
    }

    const missing = pools.filter(p => !p.address || !p.plz);
    console.log(`✅ Loaded ${pools.length} pools — ${missing.length} missing address/PLZ`);

    if (missing.length === 0) {
      console.log('Nothing to do.');
      return { success: true, totalPools: pools.length };
    }

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      if (pool.address && pool.plz) continue;

      try {
        const response = await axios.get(pool.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000
        });

        const $ = cheerio.load(response.data);
        const detail = extractAddressFromDetail($);
        if (detail) {
          pools[i].address = detail.address;
          pools[i].plz = detail.plz;
          pools[i].district = detail.district;
          console.log(`  ✅ ${pool.name.substring(0, 40)} — ${detail.address}, ${detail.plz}`);
        } else {
          console.log(`  ⚠️  ${pool.name.substring(0, 40)} — not found on page`);
        }
      } catch (error) {
        console.error(`  ❌ ${pool.name}:`, error.message);
      }

      if (i < pools.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const geocodedPools = await geocodeCatalog(pools);
    const saved = await saveCatalog(geocodedPools);

    if (!saved) {
      return { success: false, error: 'Failed to save catalog' };
    }

    console.log('\n=== FILL MISSING COMPLETE ===');
    return { success: true, totalPools: geocodedPools.length };
  } catch (error) {
    console.error('Error in fill-missing:', error);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const runFn = args.includes('--geocode-only') ? runGeocodeOnly
              : args.includes('--fill-missing') ? runFillMissing
              : run;

  runFn().then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { run, runGeocodeOnly, runFillMissing, fetchPoolCatalog, geocodeCatalog, saveCatalog, loadCatalog };
