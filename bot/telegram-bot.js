require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
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

// ─── keyboard menus ──────────────────────────────────────────────────────────

const mainMenu = {
  inline_keyboard: [
    [{ text: '🏊 All Pools', callback_data: 'pools' }, { text: '📍 Near Me', callback_data: 'near_action' }, { text: '📍 Near (Open)', callback_data: 'near_open_action' }],
    [{ text: '💾 Save Location', callback_data: 'location' },{ text: '❌ Clear Location', callback_data: 'clear_location' }],
    [{ text: '❓ Help', callback_data: 'help' }]
  ]
};

const nearMenu = {
  inline_keyboard: [
    [
      { text: '3 km', callback_data: 'near_3' },
      { text: '5 km', callback_data: 'near_5' },
      { text: '10 km', callback_data: 'near_10' }
    ],
    [{ text: '↩️ Back', callback_data: 'back_to_main' }]
  ]
};

const nearOpenMenu = {
  inline_keyboard: [
    [
      { text: '3 km', callback_data: 'near_open_3' },
      { text: '5 km', callback_data: 'near_open_5' },
      { text: '10 km', callback_data: 'near_open_10' }
    ],
    [{ text: '↩️ Back', callback_data: 'back_to_main' }]
  ]
};

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

// Safe message for MarkdownV2 (escapes all special chars)
function safeMd(str) {
  return escMd(str);
}

const TG_MAX = 4000; // Telegram hard limit is 4096; leave headroom

/**
 * Split a MarkdownV2 message into chunks that fit within TG_MAX.
 * Splits on double-newline (pool boundaries) to avoid cutting mid-entry.
 */
function splitMessage(text) {
  const chunks = [];
  const parts = text.split('\n\n');
  let current = '';

  for (const part of parts) {
    const candidate = current ? current + '\n\n' + part : part;
    if (candidate.length > TG_MAX) {
      if (current) chunks.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Send a potentially long message, splitting into multiple messages if needed.
 * opts are passed to every send/edit call.
 */
async function sendLong(chatId, text, opts = {}, editMsgId = null) {
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const chunkOpts = { ...opts, reply_markup: isLast ? opts.reply_markup : undefined };
    if (i === 0 && editMsgId) {
      await bot.editMessageText(chunks[i], { chat_id: chatId, message_id: editMsgId, ...chunkOpts });
    } else {
      await bot.sendMessage(chatId, chunks[i], chunkOpts);
    }
  }
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
    `👋 Hey ${name}! I can tell you which Berlin pools are open.`,
    { reply_markup: mainMenu }
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
    await sendLong(chatId, body, { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
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
    '📍 Share your location and I\'ll save it for quick searches.',
    {
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

async function handleNearbySearch(chatId, userId, latitude, longitude, radius, openOnly = false) {
  await bot.sendMessage(chatId, `🔍 Looking for pools within ${radius} km…`, {
    reply_markup: { remove_keyboard: true }
  });

  try {
    const data  = await fetchNearby(latitude, longitude, radius);
    let pools = data.pools ?? [];

    // Filter to open pools only if requested
    if (openOnly) {
      pools = pools.filter(p => p.availability?.status === 'open' || p.availability?.status === 'available' || p.availability?.status === 'unknown');
    }

    if (!pools.length) {
      await bot.sendMessage(chatId,
        `😕 No ${openOnly ? 'open ' : ''}pools found within ${data.searchRadius ?? radius + ' km'}.`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]] } }
      );
      return;
    }

    const header = escMd(`📍 Pools near you (${data.searchRadius}):\n\n`);
    const body   = openOnly ? pools.map(formatPool).join('\n') : formatPoolsByStatus(pools);
    await sendLong(chatId, header + body, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]] }
    });
  } catch (err) {
    console.error('nearby search error:', err);
    await bot.sendMessage(chatId, '❌ Could not reach the pools API. Try again later.', {
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]] }
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
  const radiusPreference = userRadiusPreference[userId];
  if (radiusPreference) {
    const radius = typeof radiusPreference === 'object' ? radiusPreference.radius : radiusPreference;
    const openOnly = typeof radiusPreference === 'object' ? radiusPreference.openOnly : false;
    console.log(`🔍 Searching with radius ${radius} km${openOnly ? ' (open only)' : ''}`);
    delete userRadiusPreference[userId]; // Clear so we don't reuse it
    await handleNearbySearch(chatId, userId, latitude, longitude, radius, openOnly);
  } else {
    console.log(`💾 Just saving location, no search`);
    await bot.sendMessage(chatId, '✅ Location saved! Use the menu to find pools nearby.', {
      reply_markup: mainMenu
    });
  }
});

// ─── callback query handlers (button presses) ───────────────────────────────

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  console.log(`🔘 Button pressed: ${data} by user ${userId}`);

  try {
    if (data === 'pools') {
      await bot.deleteMessage(chatId, query.message.message_id);
      const fetchMsg = await bot.sendMessage(chatId, '🔍 Fetching pools…');
      const poolData = await fetchAvailable();
      const pools = poolData.pools ?? [];

      if (!pools.length) {
        await bot.editMessageText('😴 No pools available right now.', {
          chat_id: chatId,
          message_id: fetchMsg.message_id,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]] }
        });
      } else {
        const body = formatPoolsByStatus(pools);
        await sendLong(chatId, body, {
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]] }
        }, fetchMsg.message_id);
      }
    }

    else if (data === 'near_action') {
      await bot.editMessageText('📍 Select search radius:', {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: nearMenu
      });
    }

    else if (data === 'near_open_action') {
      await bot.editMessageText('📍 Select search radius (open pools only):', {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: nearOpenMenu
      });
    }

    else if (data.startsWith('near_open_')) {
      const radius = parseInt(data.split('_')[2]);
      userRadiusPreference[userId] = { radius, openOnly: true };

      if (userLocations[userId]) {
        const { latitude, longitude } = userLocations[userId];
        await bot.deleteMessage(chatId, query.message.message_id);
        await handleNearbySearch(chatId, userId, latitude, longitude, radius, true);
      } else {
        await bot.deleteMessage(chatId, query.message.message_id);
        await bot.sendMessage(chatId,
          `📍 Send me your location and I'll find open pools within ${radius} km.`,
          {
            reply_markup: {
              keyboard: [[{ text: '📍 Share my location', request_location: true }]],
              resize_keyboard: true,
              one_time_keyboard: true
            }
          }
        );
      }
    }

    else if (data.startsWith('near_') && !data.startsWith('near_open_')) {
      const radius = parseInt(data.split('_')[1]);
      userRadiusPreference[userId] = radius;

      if (userLocations[userId]) {
        const { latitude, longitude } = userLocations[userId];
        await bot.deleteMessage(chatId, query.message.message_id);
        await handleNearbySearch(chatId, userId, latitude, longitude, radius);
      } else {
        await bot.deleteMessage(chatId, query.message.message_id);
        await bot.sendMessage(chatId,
          `📍 Send me your location and I'll find pools within ${radius} km.`,
          {
            reply_markup: {
              keyboard: [[{ text: '📍 Share my location', request_location: true }]],
              resize_keyboard: true,
              one_time_keyboard: true
            }
          }
        );
      }
    }

    else if (data === 'location') {
      await bot.deleteMessage(chatId, query.message.message_id);
      await bot.sendMessage(chatId,
        '📍 Share your location and I\'ll save it for quick searches.',
        {
          reply_markup: {
            keyboard: [[{ text: '📍 Share my location', request_location: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        }
      );
    }

    else if (data === 'clear_location') {
      delete userLocations[userId];
      await bot.editMessageText('✅ Location cleared.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: mainMenu
      });
    }

    else if (data === 'help') {
      await bot.editMessageText(
        'Berliner Bäder Bot\n\n' +
        '🏊 All Pools — show all pools\n' +
        '📍 Near Me — find pools near your location\n' +
        '💾 Save Location — remember your location\n' +
        '❌ Clear Location — forget saved location',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: mainMenu
        }
      );
    }

    else if (data === 'back_to_main') {
      await bot.editMessageText(
        '👋 Berliner Bäder Bot',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: mainMenu
        }
      );
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback query error:', err);
    await bot.answerCallbackQuery(query.id, { text: '❌ Error', show_alert: true });
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
    'Use the buttons below to search for pools.',
    { reply_markup: mainMenu }
  );
});

console.log('🤖 Pool bot is running (polling)…');