# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all workspace dependencies
npm install

# Run both services in development (with nodemon auto-reload)
npm run dev

# Run services individually
npm start --workspace=api
npm start --workspace=bot

# Scrape pool data (catalog first, then hours)
npm run scrape:all --workspace=api
node api/scraper-catalog.js          # full catalog + geocoding
node api/scraper-catalog.js --geocode-only   # re-geocode existing catalog
node api/scraper-catalog.js --fill-missing   # re-fetch detail pages for pools missing address/PLZ
node api/scraper-hours.js            # opening hours for all pools

# Use page cache to avoid re-fetching pages (useful in development)
node api/scraper-catalog.js --cache-pages
node api/scraper-hours.js --cache-pages
# or via env: PAGE_CACHE=1 node api/scraper-catalog.js
# or you can also set PAGE_CACHE=1 in your personal .env file
```

## Environment

Copy `.env` at the project root (no `.env.example` exists — create it manually):

```
BOT_TOKEN=<telegram bot token from @BotFather>
POOLS_API_URL=http://localhost:3000
DEFAULT_RADIUS_KM=3
API_PORT=3000
```

## Architecture

This is an npm workspaces monorepo with two services plus scrapers:

```
User (Telegram)
      │
      ▼
 bot/telegram-bot.js  — polling mode, no webhook
      │  HTTP
      ▼
 api/server.js  — Express REST API
      │  reads JSON files
      ▼
 data/pools-catalog.json   — static pool metadata (name, address, coords, amenities)
 data/pools-hours.json     — dynamic opening hours + availability status
```

**Data pipeline:** Scrapers write to `data/`. The API reads those files on every request (no in-memory caching). The bot only talks to the API over HTTP — it never reads data files directly.

**Two scrapers with different update frequencies:**
- `scraper-catalog.js` — runs monthly; scrapes pool list from berlinerbaeder.de (7 pages × ~10 pools), fetches each pool's detail page for address/PLZ, then geocodes via Nominatim (OpenStreetMap). Geocoding results are cached in `data/geocode-cache.json` to avoid re-hitting Nominatim.
- `scraper-hours.js` — runs daily/hourly; fetches each pool's detail page and extracts opening hours + availability status.

**Page cache** (`api/page-cache.js`): Stores fetched HTML files under `data/page-cache/` keyed by URL slug. Enabled with `--cache-pages` flag or `PAGE_CACHE=1`. Useful during development to avoid hitting berlinerbaeder.de repeatedly.

**Bot state:** User locations and radius preferences are stored in-process memory in `bot/telegram-bot.js` (`userLocations`, `userRadiusPreference`). This state is lost on restart. There is no database.

**Telegram message format:** The bot uses MarkdownV2. All user-visible strings must go through `escMd()` before being embedded in MarkdownV2 templates. Long responses are split at double-newline boundaries via `splitMessage()` to stay under Telegram's 4096-character limit.

## Key files

| File | Purpose |
|------|---------|
| `api/server.js` | Express API; merges catalog + hours data per request via `mergePools()` |
| `api/scraper-catalog.js` | Scrapes pool list and geocodes addresses; exports `run`, `runGeocodeOnly`, `runFillMissing` |
| `api/scraper-hours.js` | Scrapes opening hours and availability per pool |
| `api/geocode-cache.js` | Read/write cache for Nominatim results (`data/geocode-cache.json`) |
| `api/page-cache.js` | Read/write cache for scraped HTML pages (`data/page-cache/`) |
| `api/distance-utils.js` | Haversine distance calculation; `filterByDistance` adds `.distance` to each pool |
| `bot/telegram-bot.js` | Telegram bot; inline keyboard menus, command handlers, callback query router |
| `data/pools-catalog.json` | Output of catalog scraper (pool metadata + coords) |
| `data/pools-hours.json` | Output of hours scraper (per-pool hours object keyed by pool ID) |

## API endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Health check |
| GET | `/api/status` | Data freshness + pool counts |
| GET | `/api/pools` | All pools; `?publicOnly=true` filters to open/unknown |
| GET | `/api/pools/available` | Only open pools |
| GET | `/api/pools/near` | `?lat=…&lon=…&radius=…` — sorted by distance |
| GET | `/api/pools/by-district/:district` | Filter by Berlin district name |
| GET | `/api/pools/search` | `?q=…` — substring search on name + district |
| POST | `/api/telegram/notify` | Internal endpoint used for Telegram notification flow |

## Deployment

Deployed on Railway as two services (`api` and `bot`). See `RAILWAY_DEPLOYMENT.md` for full setup. `railway.json` configures the root-level build; each service is pointed at its workspace directory.
