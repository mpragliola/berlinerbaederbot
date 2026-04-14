/**
 * Distance calculation utilities
 * Uses Haversine formula to calculate distance between coordinates
 */

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

/**
 * Convert degrees to radians
 */
function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Filter pools by distance from a reference point
 * @param {Array} pools - Array of pool objects with latitude/longitude
 * @param {number} refLat - Reference latitude
 * @param {number} refLon - Reference longitude
 * @param {number} radiusKm - Radius in kilometers
 * @returns {Array} Filtered and sorted pools with distances
 */
function filterByDistance(pools, refLat, refLon, radiusKm) {
  return pools
    .filter(pool => {
      if (!pool.latitude || !pool.longitude) return false;
      const distance = calculateDistance(refLat, refLon, pool.latitude, pool.longitude);
      return distance <= radiusKm;
    })
    .map(pool => ({
      ...pool,
      distance: calculateDistance(refLat, refLon, pool.latitude, pool.longitude)
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Validate coordinates
 */
function isValidCoords(lat, lon) {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  if (isNaN(latitude) || isNaN(longitude)) {
    return false;
  }

  if (latitude < -90 || latitude > 90) {
    return false;
  }

  if (longitude < -180 || longitude > 180) {
    return false;
  }

  return { latitude, longitude };
}

module.exports = {
  calculateDistance,
  filterByDistance,
  isValidCoords
};
