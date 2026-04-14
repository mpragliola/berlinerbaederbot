require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE  = process.env.POOLS_API_URL || 'http://localhost:3000';
const DEFAULT_RADIUS = process.env.DEFAULT_RADIUS_KM || 3;

if (!BOT_TOKEN) {
  console.error('❌  BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Track user preferences (radius and location)
const userRadiusPreference = {};
const userLocations = {};

// ─── helpers ────────────────────────────────────────────────────────────────

function getDayName() {
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
}

function formatHours(pool) {
  const day = getDayName();
  const hours = pool.openingHours?.[day];
  if (!hours) return '—';
  if (typeof hours === 'string') return hours;
  if (hours.open && hours.close) return `${hours.open} – ${hours.close}`;
  return '—';
}

function statusEmoji(status) {
  return { open: '🟢', available: '🟢', closed: '🔴', unknown: '⚪' }[status] ?? '⚪';
}

function formatPool(pool) {
  const emoji  = statusEmoji(pool.availability?.status);
  const status = pool.availability?.status ?? 'unknown';
  const hours  = formatHours(pool);
  const dist   = pool.distance ? ` · ${pool.distance}` : '';

  let msg = `${emoji} *${escMd(pool.name)}*${escMd(dist)}\n`;
  msg    += `   📍 ${escMd(pool.district ?? 'Berlin')}\n`;
  msg    += `   🕐 Today: ${escMd(hours)}  \\(${escMd(status)}\\)\n`;
  if (pool.url) msg += `   🔗 [Details](${pool.url})\n`;
  return msg;
}

function groupPoolsByStatus(pools) {
  const open = pools.filter(p => p.availability?.status === 'open' || p.availability?.status === 'available' || p.availability?.status === 'unknown');
  const closed = pools.filter(p => p.availability?.status === 'closed');
  return { open, closed };
}

function formatPoolsByStatus(pools) {
  const { open, closed } = groupPoolsByStatus(pools);
  let msg = '';

  if (open.length > 0) {
    msg += escMd(`🏊 ${open.length} OPEN pool${open.length === 1 ? '' : 's'}:\n\n`);
    msg += open.map(formatPool).join('\n');
  }

  if (closed.length > 0) {
    if (msg) msg += '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += escMd(`😴 ${closed.length} CLOSED pool${closed.length === 1 ? '' : 's'}:\n\n`);
    msg += closed.map(formatPool).join('\n');
  }

  return msg || escMd('No pools available.');
}

// Escape special chars for MarkdownV2
function escMd(str) {
  return String(str ?? '').replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function fetchNearby(lat, lon, radius = DEFAULT_RADIUS) {
  const url = `${API_BASE}/api/pools/near?lat=${lat}&lon=${lon}&radius=${radius}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return res.json();
}

async function fetchAvailable() {
  const res = await fetch(`${API_BASE}/api/pools/available`);
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return res.json();
}

// ─── /start ─────────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const name = msg.from?.first_name ?? 'there';
  bot.sendMessage(msg.chat.id,
    `👋 Hey ${name}\\! I can tell you which Berlin pools are open\\.\n\n` +
    `*Commands:*\n` +
    `/pools — show all currently open pools\n` +
    `/near — share your location to find pools close to you\n` +
    `/help — show this message`,
    { parse_mode: 'MarkdownV2' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `*Berliner Bäder Bot*\n\n` +
    `/pools — all open pools right now\n` +
    `/near \\[km\\] — pools near your location \\(uses saved location if available\\)\n` +
    `/location — save your location for quick searches\n` +
    `/clear\\-location — forget your saved location\n\n` +
    `You can also just *send your location* directly at any time\\.`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ─── /pools — all available ──────────────────────────────────────────────────

bot.onText(/\/pools/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '🔍 Fetching pools…');

  try {
    const data = await fetchAvailable();
    const pools = data.pools ?? [];

    if (!pools.length) {
      await bot.sendMessage(chatId, '😴 No pools available right now\\.', {
        parse_mode: 'MarkdownV2'
      });
      return;
    }

    const body = formatPoolsByStatus(pools);

    await bot.sendMessage(chatId, body, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error('/pools error:', err);
    await bot.sendMessage(chatId, '❌ Could not reach the pools API\\. Try again later\\.', {
      parse_mode: 'MarkdownV2'
    });
  }
});

// ─── /location — save location for future use ─────────────────────────────

bot.onText(/\/location/, (msg) => {
  console.log(`📍 /location command received from user ${msg.from.id}`);
  bot.sendMessage(msg.chat.id,
    `📍 Share your location and I'll save it for quick searches\\.`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        keyboard: [[{ text: '📍 Share my location', request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  ).then(() => console.log(`✅ Location prompt sent`));
});

// ─── /clear-location — forget saved location ──────────────────────────────

bot.onText(/\/clear-location/, (msg) => {
  const userId = msg.from.id;
  delete userLocations[userId];
  bot.sendMessage(msg.chat.id, '✅ Location cleared\\.', { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
});

// ─── /near — find pools near you (with optional km parameter) ──────────────

bot.onText(/\/near\s*(\d+)?/, (msg, match) => {
  const userId = msg.from.id;
  const radiusParam = match[1] ? parseInt(match[1]) : DEFAULT_RADIUS;
  const radius = Math.max(0.1, Math.min(radiusParam, 100)); // Clamp 0.1-100 km

  userRadiusPreference[userId] = radius;

  // If location already saved, use it directly
  if (userLocations[userId]) {
    const { latitude, longitude } = userLocations[userId];
    handleNearbySearch(msg.chat.id, userId, latitude, longitude, radius);
    return;
  }

  // Otherwise, prompt for location
  bot.sendMessage(msg.chat.id,
    `📍 Send me your location and I'll find pools within *${radius} km*\\.`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        keyboard: [[{ text: '📍 Share my location', request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
});

// ─── Helper: search for nearby pools ───────────────────────────────────────

async function handleNearbySearch(chatId, userId, latitude, longitude, radius) {
  await bot.sendMessage(chatId, `🔍 Looking for pools within ${radius} km…`, {
    reply_markup: { remove_keyboard: true }
  });

  try {
    const data  = await fetchNearby(latitude, longitude, radius);
    const pools = data.pools ?? [];

    if (!pools.length) {
      await bot.sendMessage(chatId,
        escMd(`😕 No pools found within ${data.searchRadius ?? radius + ' km'}. Try /pools to see all pools.`),
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const header = escMd(`📍 Pools near you \\(${data.searchRadius}\\):\n\n`);
    const body   = formatPoolsByStatus(pools);

    await bot.sendMessage(chatId, header + body, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error('nearby search error:', err);
    await bot.sendMessage(chatId, '❌ Could not reach the pools API\\. Try again later\\.', {
      parse_mode: 'MarkdownV2'
    });
  }
}

// ─── incoming location ───────────────────────────────────────────────────────

bot.on('location', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const { latitude, longitude } = msg.location;

  console.log(`📍 Location received from user ${userId}: ${latitude}, ${longitude}`);

  // Always save the location
  userLocations[userId] = { latitude, longitude };
  console.log(`✅ Saved location for user ${userId}`);

  // If radius was set (from /near command), search; otherwise just confirm save
  const radius = userRadiusPreference[userId];
  if (radius) {
    console.log(`🔍 Searching with radius ${radius} km`);
    delete userRadiusPreference[userId]; // Clear so we don't reuse it
    await handleNearbySearch(chatId, userId, latitude, longitude, radius);
  } else {
    console.log(`💾 Just saving location, no search`);
    await bot.sendMessage(chatId, '✅ Location saved\\! Use /near to find pools nearby\\.', {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    });
  }
});

// ─── debug: log all messages ──────────────────────────────────────────────────

bot.on('message', (msg) => {
  console.log(`📨 Message from ${msg.from.id}:`, {
    text: msg.text,
    location: msg.location,
    type: msg.location ? 'location' : 'text'
  });

  if (msg.location || msg.text?.startsWith('/')) return;
  bot.sendMessage(msg.chat.id,
    `Use /pools to see open pools, or /near to find pools close to you\\.`,
    { parse_mode: 'MarkdownV2' }
  );
});

console.log('🤖 Pool bot is running (polling)…');