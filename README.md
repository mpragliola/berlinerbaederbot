# Berliner Bäder Pool Scraper & API Server

A Node.js application with a separate scraper and API server. The scraper extracts pool data from Berliner Bäder periodically (via cron), and the API server serves that pre-scraped data efficiently.

## Features

- 🏊 **Web Scraper**: Extracts pool data from berlinerbaeder.de (runs via cron)
- 💾 **File-based Storage**: Scraped data saved to `data/pools.json`
- ⚡ **Zero-overhead API**: Serves pre-scraped data without any scraping overhead
- 📍 **Pool Information**: Name, type, district, amenities, opening hours
- ⏰ **Availability Filtering**: Filters for public swimming availability
- 🤖 **Telegram Ready**: Endpoint for Telegram bot integration
- 🔍 **Search & Filter**: Multiple endpoints for different filtering needs
- 📊 **REST API**: Clean JSON endpoints for easy integration

## Project Structure

```
.
├── package.json              # Dependencies and scripts
├── scraper.js               # Scraping script (runs via cron)
├── server.js                # Express API server (serves data)
├── telegram-bot-example.js  # Example Telegram bot integration
├── cron-setup.md            # Cron job setup instructions
├── data/
│   └── pools.json          # Scraped data (created by scraper)
├── .env.example            # Environment variables template
├── .gitignore             # Git ignore file
└── README.md              # This file
```

## Installation

1. **Clone or create the project directory**
   ```bash
   cd /home/marco/dev/baeder
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```

4. **Configure .env** (optional)
   - Adjust `PORT` if needed
   - Add Telegram credentials when ready

## Usage

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Cron Job (hourly/daily/etc)                        │
│  Runs: node scraper.js                              │
│  Output: data/pools.json                            │
└──────────────────┬──────────────────────────────────┘
                   │ writes
                   ▼
          ┌────────────────────┐
          │  data/pools.json   │
          └────────────────────┘
                   │ reads
                   ▼
┌─────────────────────────────────────────────────────┐
│  API Server (always running)                        │
│  Runs: node server.js                               │
│  Serves: /api/pools, /api/search, etc               │
└─────────────────────────────────────────────────────┘
```

### Start the API Server

```bash
npm start
```

The server will start on `http://localhost:3000` and serve data from `data/pools.json`

### Run the Scraper Manually

```bash
npm run scrape
```

This immediately fetches pool data and saves it to `data/pools.json`

### Setup Periodic Scraping (Cron)

See [cron-setup.md](./cron-setup.md) for detailed instructions.

Quick example (run scraper every hour):
```bash
crontab -e
# Add: 0 * * * * cd /home/marco/dev/baeder && node scraper.js
```

### Development Mode (with hot reload)

```bash
npm run dev
```

Requires nodemon (included in devDependencies)

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and timestamp.

### Status
```
GET /api/status
```
Returns when the pool data was last scraped and how many pools are available.

**Example:**
```bash
curl http://localhost:3000/api/status
```

**Response:**
```json
{
  "success": true,
  "lastScraped": "2024-01-15T10:00:00.000Z",
  "totalPools": 45,
  "dataFile": "/home/marco/dev/baeder/data/pools.json"
}
```

### Get All Pools
```
GET /api/pools
```
Query parameters:
- `publicOnly=true` - Only return pools with public swimming

**Example:**
```bash
curl "http://localhost:3000/api/pools?publicOnly=true"
```

### Get Available Pools
```
GET /api/pools/available
```
Returns only pools with public swimming availability.

### Get Pools by District
```
GET /api/pools/by-district/:district
```
Filter pools by Berlin district.

**Examples:**
```bash
curl "http://localhost:3000/api/pools/by-district/Mitte"
curl "http://localhost:3000/api/pools/by-district/Charlottenburg-Wilmersdorf"
```

### Search Pools
```
GET /api/pools/search?q=query
```
Search pools by name or district (case-insensitive).

**Example:**
```bash
curl "http://localhost:3000/api/pools/search?q=mitte"
```

### Telegram Webhook
```
POST /api/telegram/notify
```

Request body:
```json
{
  "userId": "123456",
  "chatId": "789012",
  "query": "mitte",
  "type": "available"
}
```

Parameters:
- `userId` - Telegram user ID
- `chatId` - Telegram chat ID (required)
- `query` - Optional search query
- `type` - "available" or "all" (default: "available")

**Example:**
```bash
curl -X POST http://localhost:3000/api/telegram/notify \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "123456",
    "chatId": "789012",
    "query": "mitte",
    "type": "available"
  }'
```

## Response Format

All endpoints return JSON with this structure:

```json
{
  "success": true,
  "count": 5,
  "lastScraped": "2024-01-15T10:00:00.000Z",
  "pools": [
    {
      "id": 1,
      "name": "Spreebad",
      "url": "https://...",
      "type": "Freibad",
      "district": "Mitte",
      "amenities": ["Pool 50m", "Slide"],
      "openingHours": {...},
      "availability": {
        "currentStatus": "available",
        "publicSwimming": [...],
        "restrictedAreas": [...]
      }
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Fields:**
- `success` - Request was successful
- `count` - Number of pools returned
- `lastScraped` - When the data was last scraped by the scraper job
- `pools` - Array of pool objects
- `timestamp` - Current API server time

## Telegram Bot Integration

To integrate with a Telegram bot:

1. **Create a bot** via [@BotFather](https://t.me/botfather) on Telegram
2. **Install the Telegram bot library**:
   ```bash
   npm install node-telegram-bot-api
   ```
3. **Use the example bot** as a starting point:
   ```bash
   # Add your bot token to .env
   echo "TELEGRAM_BOT_TOKEN=your_token" >> .env
   
   # Run the example bot
   node telegram-bot-example.js
   ```
4. **Or integrate with your own bot** by calling the webhook:
   ```javascript
   const response = await fetch('http://localhost:3000/api/telegram/notify', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       userId: user_id,
       chatId: chat_id,
       query: search_query,
       type: 'available'
     })
   });
   const data = await response.json();
   // Format and send data to user via Telegram
   ```

## How the Scraper Works

When the scraper runs (via cron job):

1. **Fetches** the main pools page from berlinerbaeder.de
2. **Parses** HTML to extract pool cards/entries
3. **Extracts** pool information:
   - Name, URL, type (Freibad/Hallenbad/Strandbad)
   - District, amenities (25m pool, slides, saunas, etc.)
4. **Fetches** individual pool pages for details (limited to avoid rate limiting)
5. **Extracts** opening hours and availability status
6. **Saves** all results to `data/pools.json` with timestamp
7. **API server** then serves this static data on every request

The API server does **zero scraping** - it just reads and serves the JSON file.

## Customization

### Adjust Selectors
If the website structure changes, update CSS selectors in `scraper.js`:

```javascript
// In fetchAllPools()
const poolElements = $('[data-pool], .pool-item, .baeder-item, article.pool');
```

Then re-run the scraper:
```bash
npm run scrape
```

### Adjust Scrape Frequency
Edit your crontab to change how often the scraper runs:

```bash
crontab -e
```

- `0 * * * *` - Every hour
- `0 */6 * * *` - Every 6 hours
- `0 6 * * *` - Daily at 6 AM
- `0 0 * * 0` - Weekly on Sunday

See [cron-setup.md](./cron-setup.md) for more details.

### Add More Amenities
In `extractAmenities()` function in `scraper.js`:

```javascript
const amenityKeywords = {
  '25m': 'Pool 25m',
  'rutsche': 'Slide',
  // Add more here
};
```

## Troubleshooting

**No pools found / Data is stale:**
- Run the scraper manually: `npm run scrape`
- Check that `data/pools.json` exists and has content
- Verify cron job is running: `crontab -l`
- Check cron logs: `grep CRON /var/log/syslog`

**Website structure changed and scraper isn't finding pools:**
- Open the website in a browser
- Check browser inspector to find current CSS selectors
- Update `fetchAllPools()` CSS selectors in `scraper.js`
- Run scraper again: `npm run scrape`

**API returns empty or old data:**
- Check `/api/status` to see when data was last scraped
- Manually run scraper: `npm run scrape`
- Verify `data/pools.json` is readable: `cat data/pools.json`

**Telegram bot integration not working:**
- Verify bot token is correct in `.env`
- Test with curl first: `curl http://localhost:3000/api/telegram/notify -X POST -H "Content-Type: application/json" -d '{"chatId": "123"}'`
- Check network connectivity to localhost

## Performance

- **API requests**: <10ms (reads from JSON file)
- **Scraper runtime**: 2-5 seconds (only runs periodically)
- **Memory usage**: ~5MB for API server
- **Data freshness**: Depends on cron interval (hourly/daily/etc)

## License

MIT

## Contributing

Feel free to update selectors and add features as the website changes.
