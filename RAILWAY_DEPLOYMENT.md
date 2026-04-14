# Railway Deployment Guide

This is a monorepo with two services: **API** (`/api`) and **Bot** (`/bot`).

## Project Structure

```
.
├── api/              # Express API server
│   ├── server.js
│   ├── scraper-*.js
│   └── package.json
├── bot/              # Telegram bot
│   ├── telegram-bot.js
│   └── package.json
├── package.json      # Root monorepo config
└── railway.json      # Railway build config
```

## Railway Setup

### 1. Create Project on Railway

- Go to [railway.app](https://railway.app)
- Click "New Project"
- Select "Deploy from GitHub"
- Choose your monorepo repository

### 2. Add Services

Railway will auto-detect the monorepo. You need **two services**:

#### Service 1: API

1. Click "New Service"
2. Select "GitHub"
3. Choose the repo, set:
   - **Root Directory**: `api`
   - **Start Command**: `npm start`
   - **Port**: 3000

Environment variables:
```
API_PORT=3000
NODE_ENV=production
```

#### Service 2: Bot

1. Click "New Service"
2. Select "GitHub"
3. Choose the repo, set:
   - **Root Directory**: `bot`
   - **Start Command**: `npm start`

Environment variables:
```
BOT_TOKEN=your_telegram_bot_token_here
POOLS_API_URL=http://api:3000
DEFAULT_RADIUS_KM=3
NODE_ENV=production
```

### 3. Set Environment Variables

In Railway Dashboard → Variables:

**API Service:**
```
API_PORT=3000
NODE_ENV=production
```

**Bot Service:**
```
BOT_TOKEN=your_telegram_bot_token_here
POOLS_API_URL=http://api:3000
DEFAULT_RADIUS_KM=3
NODE_ENV=production
```

The key: In the bot, use `http://api:3000` for internal Railway communication (Railway's internal DNS resolves `api` to the API service).

### 4. Deploy

Push to GitHub:
```bash
git add .
git commit -m "chore: setup monorepo structure for Railway"
git push origin main
```

Railway will automatically deploy both services.

### 5. Monitor

- Dashboard → View logs for each service
- Check both services are running
- Bot should connect to API via internal network

## Local Development

### Setup

```bash
npm install          # Installs dependencies for all workspaces

# Create .env files
cp .env.example .env
# Edit /bot/.env:
BOT_TOKEN=your_token
POOLS_API_URL=http://localhost:3000

# Edit /api/.env if needed
```

### Run Both Services

```bash
npm run dev          # Runs both API and bot with nodemon
```

Or individually:
```bash
npm start --workspace=api
npm start --workspace=bot
```

### Scraping

```bash
npm run scrape:all   # Runs scrapers in /api
```

## Troubleshooting

**Bot can't reach API:**
- Check `POOLS_API_URL` in bot service variables
- Use `http://api:3000` for internal communication
- Check API service is running (view logs)

**Deploy fails:**
- Check Node.js version compatibility
- Ensure `package.json` is in root directory
- View Railway deployment logs for details

**Missing dependencies:**
- Run `npm install` before deploying
- Commit `package-lock.json` to git

## Architecture

```
User (Telegram) ──→ Bot Service (Railway)
                         ↓
                    http://api:3000
                         ↓
                    API Service (Railway)
                         ↓
                    Pool Data (cached)
```
