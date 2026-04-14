# Berliner Bäder Bot

A Telegram bot that shows which Berlin pools are open, with distance-based search. Built as a Node.js monorepo with a separate API service and bot service.

## Project Structure

```
.
├── api/
│   ├── server.js            # Express API server
│   ├── scraper-catalog.js   # Scrapes pool list from berlinerbaeder.de
│   ├── scraper-hours.js     # Scrapes opening hours per pool
│   ├── distance-utils.js    # Haversine distance helpers
│   ├── geocode-cache.js     # Nominatim geocoding with local cache
│   ├── geocode-cache.json   # Cached geocoding results (gitignored in prod)
│   ├── pools-catalog.json   # Scraped pool catalog
│   └── package.json
├── bot/
│   ├── telegram-bot.js      # Telegram bot (polling mode)
│   └── package.json
├── package.json             # Root monorepo config
├── railway.json             # Railway deployment config
├── RAILWAY_DEPLOYMENT.md    # Deployment guide
└── README.md
```

## Features

- 🏊 **All Pools** — lists every open pool right now
- 📍 **Near Me** — finds pools within a chosen radius of your location
- 💾 **Save Location** — remembers your location for quick repeat searches
- ⏰ **Opening Hours** — real-time availability scraped from berlinerbaeder.de

## Location Storage

Saved locations are stored **in memory** in the bot process:

- **Shared across devices** — Telegram user IDs are account-based, so saving from your phone works on desktop too.
- **Lost on restart** — if the bot service restarts (crash, redeploy), all saved locations are cleared and users need to share their location again.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Show the main menu |
| `/pools` | List all open pools right now |
| `/near [km]` | Find pools within `km` of your saved location |
| `/location` | Save your location |
| `/clear-location` | Forget your saved location |
| `/help` | Show help |

You can also just send your location directly at any time.

## Local Development

### Prerequisites

- Node.js 18+
- A Telegram bot token (create one via [@BotFather](https://t.me/botfather))

### Setup

```bash
npm install        # installs all workspace dependencies

# create .env in the project root
cp .env.example .env
# set BOT_TOKEN and POOLS_API_URL in .env
```

### Run Both Services

```bash
npm run dev        # starts API + bot with nodemon
```

Or individually:

```bash
npm start --workspace=api
npm start --workspace=bot
```

### Scrape Pool Data

```bash
npm run scrape:all   # runs scraper-catalog.js and scraper-hours.js
```

## Deployment

See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) for full Railway setup instructions.

**Environment variables:**

| Variable | Service | Description |
|----------|---------|-------------|
| `BOT_TOKEN` | bot | Telegram bot token |
| `POOLS_API_URL` | bot | Base URL of the API service (e.g. `http://api:3000`) |
| `DEFAULT_RADIUS_KM` | bot | Default search radius (default: `3`) |
| `API_PORT` | api | Port for the API server (default: `3000`) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health check |
| `GET` | `/api/status` | Data freshness and pool count |
| `GET` | `/api/pools` | All pools (`?publicOnly=true`) |
| `GET` | `/api/pools/available` | Pools open right now |
| `GET` | `/api/pools/by-district/:district` | Filter by Berlin district |
| `GET` | `/api/pools/search?q=query` | Search by name or district |
| `GET` | `/api/pools/near?lat=…&lon=…&radius=…` | Pools within radius (km) |

## Architecture

```
User (Telegram)
      │
      ▼
 Bot Service  (polling)
      │  HTTP
      ▼
 API Service  ←── Cron scrapers (catalog + hours)
      │
      ▼
 pools-catalog.json / geocode-cache.json
```
