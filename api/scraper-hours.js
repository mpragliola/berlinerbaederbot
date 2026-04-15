require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const pageCache = require('./page-cache');

/**
 * Scraper for pool opening hours and availability (frequent updates)
 * Runs daily or hourly to get opening hours and current status
 * Uses pool URLs from catalog
 */

const BASE_URL = 'https://www.berlinerbaeder.de';
const CATALOG_FILE = path.join(__dirname, '..', 'data', 'pools-catalog.json');
const HOURS_FILE = path.join(__dirname, '..', 'data', 'pools-hours.json');

/**
 * Load pool catalog
 */
async function loadCatalog() {
  try {
    const data = await fs.readFile(CATALOG_FILE, 'utf-8');
    const catalog = JSON.parse(data);
    return catalog.pools || [];
  } catch (error) {
    console.error('❌ Could not load catalog:', error.message);
    return [];
  }
}

/**
 * Extract opening hours from pool detail page
 * Returns structured format: {"open": "HH:MM", "close": "HH:MM"}
 */
function extractOpeningHours($) {
  const hours = {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null
  };

  // Get text and normalize whitespace
  let text = $('body').text();
  // Replace multiple whitespace/newlines/tabs with single space
  text = text.replace(/\s+/g, ' ');

  // Look for opening hours pattern: HH:MM - HH:MM
  const timePattern = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/;

  if (text) {
    // Try to assign to days of week
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const fullDayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

    // Find time slots near day names
    fullDayNames.forEach((dayName, index) => {
      if (text.includes(dayName)) {
        // Find the first time slot after this day name
        const dayIndex = text.indexOf(dayName);
        const textAfterDay = text.substring(dayIndex, dayIndex + 150);
        const timeMatch = textAfterDay.match(timePattern);
        if (timeMatch) {
          // Parse opening and closing times
          const openHour = parseInt(timeMatch[1]);
          const openMin = parseInt(timeMatch[2]);
          const closeHour = parseInt(timeMatch[3]);
          const closeMin = parseInt(timeMatch[4]);

          hours[dayNames[index]] = {
            open: `${String(openHour).padStart(2, '0')}:${String(openMin).padStart(2, '0')}`,
            close: `${String(closeHour).padStart(2, '0')}:${String(closeMin).padStart(2, '0')}`
          };
        }
      }
    });
  }

  return hours;
}

/**
 * Extract availability status from pool page
 */
function extractAvailability($) {
  const text = $('body').text().toLowerCase();

  let status = 'unknown';
  if (text.includes('geschlossen') || text.includes('closed')) {
    status = 'closed';
  } else if (text.includes('verfügbar') || text.includes('available') || text.includes('offen')) {
    status = 'open';
  }

  return {
    status,
    lastChecked: new Date().toISOString()
  };
}

/**
 * Fetch hours for a single pool
 */
async function fetchPoolHours(pool, usePageCache = false) {
  try {
    const { html, fromCache } = await pageCache.fetchPage(pool.url, usePageCache);
    const $ = cheerio.load(html);

    const openingHours = extractOpeningHours($);
    const availability = extractAvailability($);

    return {
      id: pool.id,
      name: pool.name,
      openingHours,
      availability,
      fromCache
    };
  } catch (error) {
    console.error(`  ❌ Error fetching hours for ${pool.name}:`, error.message);
    return {
      id: pool.id,
      name: pool.name,
      openingHours: {
        monday: null, tuesday: null, wednesday: null, thursday: null,
        friday: null, saturday: null, sunday: null
      },
      availability: { status: 'unknown', lastChecked: new Date().toISOString() },
      fromCache: false
    };
  }
}

/**
 * Fetch hours for all pools
 */
async function fetchAllHours(pools, usePageCache = false) {
  try {
    console.log(`🏊 Starting to fetch opening hours for ${pools.length} pools...`);
    if (usePageCache) console.log('   📦 Page cache enabled');

    const allHours = {};
    let fetchCount = 0;

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const hours = await fetchPoolHours(pool, usePageCache);
      console.log(`  ${hours.fromCache ? '📦' : '⏱️ '} Pool ${i + 1}/${pools.length}: ${pool.name.substring(0, 40)}`);
      allHours[pool.id] = hours;

      // Only delay after live network requests
      if (!hours.fromCache && i < pools.length - 1) {
        if (fetchCount % 10 === 9) {
          console.log(`  ⏸️  Waiting after ${fetchCount + 1} live fetches...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      if (!hours.fromCache) fetchCount++;
    }

    return allHours;
  } catch (error) {
    console.error('Error fetching hours:', error.message);
    return {};
  }
}

/**
 * Save hours to file
 */
async function saveHours(hoursData) {
  try {
    const dataDir = path.dirname(HOURS_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    const data = {
      lastUpdated: new Date().toISOString(),
      totalPools: Object.keys(hoursData).length,
      hours: hoursData
    };

    await fs.writeFile(HOURS_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Saved hours for ${Object.keys(hoursData).length} pools`);
    return true;
  } catch (error) {
    console.error('Error saving hours:', error.message);
    return false;
  }
}

/**
 * Run hours scraper
 */
async function run(usePageCache = false) {
  try {
    console.log('🔄 Starting pool hours scrape cycle...\n');

    const pools = await loadCatalog();

    if (pools.length === 0) {
      return {
        success: false,
        error: 'No pools found in catalog'
      };
    }

    const hoursData = await fetchAllHours(pools, usePageCache);

    if (Object.keys(hoursData).length === 0) {
      return {
        success: false,
        error: 'Failed to fetch any hours'
      };
    }

    const saved = await saveHours(hoursData);

    if (!saved) {
      return {
        success: false,
        error: 'Failed to save hours'
      };
    }

    console.log('\n=== HOURS SCRAPE COMPLETE ===');
    console.log(`✅ Fetched hours for ${Object.keys(hoursData).length} pools`);
    console.log(`✅ File: ${HOURS_FILE}\n`);

    return {
      success: true,
      totalPools: Object.keys(hoursData).length
    };
  } catch (error) {
    console.error('Error in hours scraper:', error);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const usePageCache = args.includes('--cache-pages') || process.env.PAGE_CACHE === '1';

  run(usePageCache).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { run, fetchAllHours, fetchPoolHours, saveHours, loadCatalog };
