const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { filterByDistance, isValidCoords } = require('./distance-utils');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const CATALOG_FILE = path.join(__dirname, '..', 'data', 'pools-catalog.json');
const HOURS_FILE = path.join(__dirname, '..', 'data', 'pools-hours.json');

// Middleware
app.use(express.json());

/**
 * Load pool catalog (static)
 */
async function loadCatalog() {
  try {
    const data = await fs.readFile(CATALOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('⚠️  Could not load catalog:', error.message);
    return { lastUpdated: null, totalPools: 0, pools: [] };
  }
}

/**
 * Load pool hours (dynamic)
 */
async function loadHours() {
  try {
    const data = await fs.readFile(HOURS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('⚠️  Could not load hours:', error.message);
    return { lastUpdated: null, totalPools: 0, hours: {} };
  }
}

/**
 * Merge catalog and hours data
 */
function mergePools(catalog, hoursData) {
  const hoursMap = hoursData.hours || {};

  return (catalog.pools || []).map(pool => {
    const poolHours = hoursMap[String(pool.id)] || {
      openingHours: {
        monday: null, tuesday: null, wednesday: null, thursday: null,
        friday: null, saturday: null, sunday: null
      },
      availability: { status: 'unknown', lastChecked: null }
    };

    return {
      ...pool,
      openingHours: poolHours.openingHours,
      availability: poolHours.availability
    };
  });
}

/**
 * Get all pools (merged from catalog and hours)
 */
async function getAllPools() {
  const [catalog, hoursData] = await Promise.all([
    loadCatalog(),
    loadHours()
  ]);

  return {
    pools: mergePools(catalog, hoursData),
    catalogUpdated: catalog.lastUpdated,
    hoursUpdated: hoursData.lastUpdated
  };
}

/**
 * Helper: Filter pools for public swimming
 */
function filterPublicSwimming(pools) {
  return pools.filter(pool => {
    if (!pool.availability) return false;
    return pool.availability.status === 'open' ||
           pool.availability.status === 'available';
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/status
 * Check when data was last updated
 */
app.get('/api/status', async (req, res) => {
  try {
    const catalog = await loadCatalog();
    const hours = await loadHours();

    res.json({
      success: true,
      catalog: {
        totalPools: catalog.totalPools,
        lastUpdated: catalog.lastUpdated
      },
      hours: {
        totalPools: hours.totalPools,
        lastUpdated: hours.lastUpdated
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pools
 * Get all pools with their catalog and hours data
 * Query params:
 *   - publicOnly: true to only return open pools
 */
app.get('/api/pools', async (req, res) => {
  try {
    const publicOnly = req.query.publicOnly === 'true';
    const data = await getAllPools();

    let pools = data.pools;

    if (publicOnly) {
      pools = filterPublicSwimming(pools);
    }

    res.json({
      success: true,
      count: pools.length,
      catalogUpdated: data.catalogUpdated,
      hoursUpdated: data.hoursUpdated,
      pools,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/pools:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pools/by-district/:district
 * Get pools filtered by district
 */
app.get('/api/pools/by-district/:district', async (req, res) => {
  try {
    const district = req.params.district;
    const data = await getAllPools();
    const pools = data.pools.filter(pool => pool.district === district);

    res.json({
      success: true,
      district,
      count: pools.length,
      catalogUpdated: data.catalogUpdated,
      hoursUpdated: data.hoursUpdated,
      pools,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/pools/by-district:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pools/available
 * Get only open pools
 */
app.get('/api/pools/available', async (req, res) => {
  try {
    const data = await getAllPools();
    const pools = filterPublicSwimming(data.pools);

    res.json({
      success: true,
      count: pools.length,
      catalogUpdated: data.catalogUpdated,
      hoursUpdated: data.hoursUpdated,
      pools,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/pools/available:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pools/search
 * Search pools by name or district
 */
app.get('/api/pools/search', async (req, res) => {
  try {
    const query = req.query.q?.toLowerCase();

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required'
      });
    }

    const data = await getAllPools();
    const pools = data.pools.filter(pool =>
      pool.name.toLowerCase().includes(query) ||
      pool.district?.toLowerCase().includes(query)
    );

    res.json({
      success: true,
      query,
      count: pools.length,
      catalogUpdated: data.catalogUpdated,
      hoursUpdated: data.hoursUpdated,
      pools,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/pools/search:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pools/near
 * Get pools near a reference point (home coordinates)
 * Query params (required):
 *   - lat: latitude (e.g., 52.5200)
 *   - lon: longitude (e.g., 13.4050)
 *   - radius: search radius in km (default: 5)
 *
 * Example: GET /api/pools/near?lat=52.5200&lon=13.4050&radius=5
 */
app.get('/api/pools/near', async (req, res) => {
  try {
    const { lat, lon, radius = 5 } = req.query;

    // Validate required parameters
    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        error: 'lat and lon parameters required',
        example: '/api/pools/near?lat=52.5200&lon=13.4050&radius=5'
      });
    }

    // Validate coordinates
    const coords = isValidCoords(lat, lon);
    if (!coords) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinates. lat must be -90 to 90, lon must be -180 to 180'
      });
    }

    const radiusKm = Math.max(0.1, Math.min(parseFloat(radius) || 5, 100)); // 0.1km to 100km

    const data = await getAllPools();
    const poolsWithoutCoords = data.pools.filter(p => !p.latitude || !p.longitude);
    const poolsWithCoords = data.pools.filter(p => p.latitude && p.longitude);

    // Filter by distance
    const nearby = filterByDistance(
      poolsWithCoords,
      coords.latitude,
      coords.longitude,
      radiusKm
    );

    res.json({
      success: true,
      count: nearby.length,
      referencePoint: {
        latitude: coords.latitude,
        longitude: coords.longitude
      },
      searchRadius: `${radiusKm} km`,
      poolsWithoutCoords: poolsWithoutCoords.length,
      catalogUpdated: data.catalogUpdated,
      hoursUpdated: data.hoursUpdated,
      pools: nearby.map(pool => ({
        ...pool,
        distance: `${pool.distance.toFixed(2)} km`
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/pools/near:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/telegram/notify
 * Endpoint for Telegram bot
 */
app.post('/api/telegram/notify', async (req, res) => {
  try {
    const { userId, chatId, query, type = 'available' } = req.body;

    if (!chatId) {
      return res.status(400).json({
        success: false,
        error: 'chatId is required'
      });
    }

    const data = await getAllPools();
    let pools = data.pools;

    if (type === 'available') {
      pools = filterPublicSwimming(pools);
    }

    if (query) {
      pools = pools.filter(pool =>
        pool.name.toLowerCase().includes(query.toLowerCase()) ||
        pool.district?.toLowerCase().includes(query.toLowerCase())
      );
    }

    // Format for Telegram
    const formattedPools = pools.map(pool => ({
      name: pool.name,
      type: pool.type,
      district: pool.district,
      amenities: pool.amenities,
      status: pool.availability?.status || 'unknown',
      url: pool.url
    }));

    res.json({
      success: true,
      userId,
      chatId,
      count: formattedPools.length,
      catalogUpdated: data.catalogUpdated,
      hoursUpdated: data.hoursUpdated,
      pools: formattedPools,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/telegram/notify:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🏊 Berliner Bäder API server running on http://localhost:${PORT}`);
  console.log('\n📚 Available endpoints:');
  console.log(`   GET  /health`);
  console.log(`   GET  /api/status`);
  console.log(`   GET  /api/pools`);
  console.log(`   GET  /api/pools/available`);
  console.log(`   GET  /api/pools/by-district/:district`);
  console.log(`   GET  /api/pools/search?q=query`);
  console.log(`   GET  /api/pools/near?lat=52.52&lon=13.40&radius=5`);
  console.log(`   POST /api/telegram/notify\n`);
});

module.exports = app;
