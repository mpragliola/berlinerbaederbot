# Distance Queries

## Overview

The system now supports distance-based queries so you can find pools near your home coordinates.

## API Endpoint

```
GET /api/pools/near?lat=52.5200&lon=13.4050&radius=5
```

### Parameters

- **lat** (required): Latitude of your reference point (e.g., home)
- **lon** (required): Longitude of your reference point
- **radius** (optional): Search radius in km (default: 5, min: 0.1, max: 100)

### Example

Find all pools within 5km of Berlin Mitte center:

```bash
curl "http://localhost:3000/api/pools/near?lat=52.5200&lon=13.4050&radius=5"
```

Response:

```json
{
  "success": true,
  "count": 12,
  "referencePoint": {
    "latitude": 52.52,
    "longitude": 13.405
  },
  "searchRadius": "5 km",
  "poolsWithoutCoords": 27,
  "pools": [
    {
      "id": 0,
      "name": "Kombibad Seestraße - Hallenbad",
      "district": "Mitte",
      "latitude": 52.5532,
      "longitude": 13.3974,
      "distance": "5.23 km",
      "type": "Hallenbad",
      "address": "Krumme Straße 10",
      "amenities": [],
      "availability": { ... }
    }
  ]
}
```

## How It Works

### Data Flow

```
1. Catalog Scraper (monthly)
   ├─ Extracts pool addresses from detail pages
   ├─ Geocodes addresses → coordinates (with caching!)
   └─ Saves to pools-catalog.json

2. Geocode Cache (persistent)
   └─ Stores address → coordinates mappings
      (no need to re-geocode same addresses)

3. API Server
   ├─ Loads pools + coordinates
   ├─ Calculates distances using Haversine formula
   └─ Returns sorted by distance
```

### Distance Calculation

Uses **Haversine formula** (pure math, no API calls):

```
distance = 2 * R * atan2(√a, √(1−a))

where:
  R = Earth's radius (6371 km)
  a = sin²(Δlat/2) + cos(lat1)*cos(lat2)*sin²(Δlon/2)
```

**Benefits:**
- ✅ No external API calls for distance queries
- ✅ Instant calculations (< 1ms for 67 pools)
- ✅ Works offline
- ✅ Completely free

## Finding Your Home Coordinates

### Option 1: Google Maps
1. Right-click on your location
2. Click coordinates (top of popup)
3. Copy lat, lon

### Option 2: OpenStreetMap
1. Visit https://www.openstreetmap.org
2. Search for your address
3. Click on it
4. Coordinates in left sidebar

### Option 3: Online Tool
- https://www.latlong.net
- Search by address
- Get coordinates instantly

### Example Home Coordinates
- **Berlin Mitte**: 52.5200, 13.4050
- **Charlottenburg**: 52.5200, 13.2950
- **Friedrichshain**: 52.5150, 13.4550

## Geocoding Cache

### How It Works

```
Address → Coordinates Mapping
────────────────────────────

First run:
  "Krumme Straße 10" + "Mitte" 
    → Query Nominatim (slow)
    → Cache result
    → Return coordinates

Second run (same address):
  "Krumme Straße 10" + "Mitte"
    → Found in cache ✅
    → Return instantly (no Nominatim call)
```

### Cache File

```
data/geocode-cache.json
```

Shows:
- Total cached entries
- Each address → lat/lon mapping
- When each was cached

### Cache Benefits

- ✅ Monthly catalog scrapes only geocode NEW pools
- ✅ Addresses rarely change → high cache hit rate
- ✅ Fast scraping even with 40+ pools to geocode
- ✅ Respectful to Nominatim (fewer requests)

## Telegram Bot Integration

```python
# In your Telegram bot command handler:

user_lat = 52.5200  # User's home latitude
user_lon = 13.4050  # User's home longitude
radius = 5          # Search within 5km

response = requests.get(
    'http://localhost:3000/api/pools/near',
    params={
        'lat': user_lat,
        'lon': user_lon,
        'radius': radius
    }
)

pools = response.json()['pools']

for pool in pools:
    message = f"{pool['name']}\n"
    message += f"📍 {pool['distance']} away\n"
    message += f"📍 {pool['district']}\n"
    message += f"🏢 {pool['type']}"
    
    bot.send_message(chat_id, message)
```

## Rate Limiting & Respect

### Nominatim Guidelines
- **Requests per second**: 1 req/sec default
- **Our rate**: 1.5 sec between requests (respectful)
- **Caching**: Dramatically reduces requests
- **Backoff**: Auto-retry on 429 with exponential backoff

### Monthly Impact
- **First month**: ~40 geocoding requests (addresses extracted)
- **Second month**: ~5 new addresses (mostly cache hits)
- **Third month**: ~2 new addresses (pool list very stable)

This means **monthly geocoding cost drops over time** as cache builds up.

## Troubleshooting

### "poolsWithoutCoords": 27

Some pools don't have coordinates because:
- Address extraction failed (page layout changed)
- Nominatim couldn't find the address
- Poor address quality on website

To improve:
1. Manually add missing addresses to pool detail pages
2. Re-run scraper to geocode them
3. Submit improvements to Berliner Bäder website

### Distance seems wrong

- Verify coordinates are correct (check map)
- Haversine formula uses great-circle distance (not road distance)
- Road distance would be ~20-30% longer

## Future Improvements

- [ ] Get actual road distances (Google Maps API - requires key)
- [ ] Support address-based queries ("find pools near Charlottenburg")
- [ ] Reverse geocoding (get address from coordinates)
- [ ] Save user home coordinates in Telegram bot settings
