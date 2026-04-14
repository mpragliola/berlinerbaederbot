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
function extractDistrictFromDetail($) {
  const text = $('body').text();
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
 * Extract address from pool detail page
 * Only extracts actual street addresses (not full page text)
 */
function extractAddressFromDetail($) {
  // Look for clean address pattern: "Street Name Number"
  // Examples: "Krumme Straße 10", "Fritz-Lesch-Straße 24", "Wiener Straße 59H"

  const text = $('body').text();
  const lines = text.split('\n');

  for (const line of lines) {
    const cleaned = line.trim();

    // Skip very long lines (likely page content, not addresses)
    if (cleaned.length > 150) continue;

    // Pattern: Word(s) + Straße/Str./Weg/Platz/Allee + number (+ optional letter)
    const addressPattern = /^([\w\-\s]+(?:straße|str\.|weg|platz|allee)[\s\.]*\d+[a-z]?)\s*$/i;
    const match = cleaned.match(addressPattern);

    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Geocode address using Nominatim (OpenStreetMap)
 * Checks cache first, only calls Nominatim for uncached addresses
 * Handles rate limiting with exponential backoff
 * Returns { latitude, longitude } or null on failure
 */
async function geocodeAddress(address, district, retryCount = 0) {
  try {
    if (!address) return null;

    // Check cache first
    const cached = await geocodeCache.getCached(address, district);
    if (cached) {
      return {
        latitude: cached.latitude,
        longitude: cached.longitude
      };
    }

    // Not in cache, query Nominatim
    const query = `${address}, ${district}, Berlin, Germany`;
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
      const coords = {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon)
      };

      // Cache the result
      await geocodeCache.setCached(address, district, coords.latitude, coords.longitude);

      return coords;
    }

    return null;
  } catch (error) {
    // Handle rate limiting (429) with exponential backoff
    if (error.response && error.response.status === 429) {
      if (retryCount < 3) {
        const backoffMs = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
        console.log(`  ⏱️  Rate limited. Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return geocodeAddress(address, district, retryCount + 1);
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
 * Fetch district from pool detail page
 */
async function fetchPoolDistrict(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });

    const $ = cheerio.load(response.data);
    return extractDistrictFromDetail($);
  } catch (error) {
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
            amenities,
            needsDistrictFetch: !district // Flag for later
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

    // Fetch missing districts and addresses from detail pages
    console.log(`\n🔍 Fetching districts and addresses...`);
    let districtCount = 0;
    let addressCount = 0;

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];

      if (pool.needsDistrictFetch) {
        try {
          const response = await axios.get(pool.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 5000
          });

          const $ = cheerio.load(response.data);

          // Extract district if missing
          if (!pool.district) {
            const district = extractDistrictFromDetail($);
            if (district) {
              pools[i].district = district;
              districtCount++;
            }
          }

          // Extract address
          const address = extractAddressFromDetail($);
          if (address) {
            pools[i].address = address;
            addressCount++;
          }

          console.log(`  ✅ ${pool.name.substring(0, 35)} - District: ${pools[i].district || 'N/A'}`);
        } catch (error) {
          console.error(`  ❌ Error fetching details for ${pool.name}:`, error.message);
        }

        // Add delay between detail page requests
        if (i < pools.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }

    console.log(`\n✅ Found ${pools.length} pools`);
    console.log(`   📍 Districts: ${districtCount} fetched`);
    console.log(`   🏠 Addresses: ${addressCount} extracted`);

    // Remove the temporary flag
    pools.forEach(pool => delete pool.needsDistrictFetch);

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

  const cacheStats = await geocodeCache.getStats();
  console.log(`   Cache has ${cacheStats.totalEntries} entries`);

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];

    if (pool.address && pool.district) {
      const isCached = await geocodeCache.getCached(pool.address, pool.district);

      const coords = await geocodeAddress(pool.address, pool.district);
      if (coords) {
        pools[i].latitude = coords.latitude;
        pools[i].longitude = coords.longitude;
        geocodedCount++;

        const cacheStatus = isCached ? '📦' : '🌐';
        if (isCached) {
          cacheHits++;
          console.log(`  ${cacheStatus} ${pool.name.substring(0, 35)} -> ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)} (cached)`);
        } else {
          cacheMisses++;
          console.log(`  ${cacheStatus} ${pool.name.substring(0, 35)} -> ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)} (new)`);
        }
      }

      // Add delay between Nominatim requests (respectful to free service)
      // Cache hits are instant, no delay needed for those
      if (i < pools.length - 1 && !isCached) {
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay
      }
    }
  }

  console.log(`\n✅ Geocoding complete`);
  console.log(`   🌍 Coordinates: ${geocodedCount} geocoded (${cacheHits} cached, ${cacheMisses} new)`);

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

// Run if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const geocodeOnly = args.includes('--geocode-only');

  const runFn = geocodeOnly ? runGeocodeOnly : run;
  runFn().then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { run, runGeocodeOnly, fetchPoolCatalog, geocodeCatalog, saveCatalog, loadCatalog };
