# Setting Up Periodic Scraping with Cron

The system uses **two separate scrapers**:

1. **Catalog Scraper** (`scraper-catalog.js`) - Pool metadata (runs monthly)
   - Pool names, types, districts, URLs, amenities
   - Takes ~1-2 minutes (includes fetching districts from detail pages)
   - Updates infrequently since pool list is stable

2. **Hours Scraper** (`scraper-hours.js`) - Opening hours (runs daily/hourly)
   - Opening hours, current availability status
   - Takes ~1 minute for all 67 pools
   - Updates frequently since hours change

Here's how to set them up:

## Option 1: System Cron Job (Recommended)

Edit your crontab:
```bash
crontab -e
```

### Catalog Scraper (Monthly)
Run once a month to update the pool catalog:

```cron
# 1st of month at 3 AM
0 3 1 * * cd /home/marco/dev/baeder && npm run scrape:catalog >> /var/log/baeder-catalog.log 2>&1
```

### Hours Scraper (Frequent)
Run daily to update opening hours:

```cron
# Every day at midnight
0 0 * * * cd /home/marco/dev/baeder && npm run scrape:hours >> /var/log/baeder-hours.log 2>&1
```

Or run hourly for more frequent updates:

```cron
# Every hour at minute 0
0 * * * * cd /home/marco/dev/baeder && npm run scrape:hours >> /var/log/baeder-hours.log 2>&1
```

### Combined (Both)
Run both in sequence:

```cron
# Monthly catalog + daily hours
0 3 1 * * cd /home/marco/dev/baeder && npm run scrape:all >> /var/log/baeder-scrape.log 2>&1
0 0 * * * cd /home/marco/dev/baeder && npm run scrape:hours >> /var/log/baeder-hours.log 2>&1
```

## Option 2: Node-based Scheduler (With your app)

If you prefer scheduling within Node.js, install node-schedule:

```bash
npm install node-schedule
```

Create `scheduler.js`:
```javascript
const schedule = require('node-schedule');
const scraper = require('./scraper');

// Run scraper every hour at minute 0
const job = schedule.scheduleJob('0 * * * *', async () => {
  console.log('🔄 Running scheduled scrape...');
  const result = await scraper.run();
  console.log(result);
});

console.log('📅 Scraper scheduled to run hourly');
```

Then run it in the background:
```bash
node scheduler.js &
```

Or with nodemon:
```bash
npm install -D nodemon
nodemon scheduler.js
```

## Option 3: PM2 with Cron

If using PM2 for process management:

```bash
npm install -g pm2
```

Create `pm2-config.json`:
```json
{
  "apps": [
    {
      "name": "baeder-api",
      "script": "server.js",
      "instances": 1,
      "exec_mode": "fork"
    },
    {
      "name": "baeder-scraper",
      "script": "scraper.js",
      "instances": 1,
      "exec_mode": "fork",
      "cron_restart": "0 * * * *"
    }
  ]
}
```

Start with:
```bash
pm2 start pm2-config.json
pm2 save
pm2 startup
```

## Monitoring the Scraper

Check if it's running:
```bash
tail -f /var/log/baeder-scraper.log
```

Check the most recent scrape status:
```bash
curl http://localhost:3000/api/status
```

This returns:
```json
{
  "success": true,
  "lastScraped": "2024-01-15T10:00:00.000Z",
  "totalPools": 45,
  "dataFile": "/home/marco/dev/baeder/data/pools.json"
}
```

## Data Storage

Scraped data is stored in:
```
/home/marco/dev/baeder/data/pools.json
```

This file contains:
- `lastScraped` - ISO timestamp of last scrape
- `totalPools` - Count of pools
- `pools` - Array of pool objects

## Testing

Run the scraper manually:
```bash
npm run scrape
```

Then query the API:
```bash
curl http://localhost:3000/api/pools/available
```
