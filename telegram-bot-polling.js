// Local Telegram Bot Runner (Long Polling mode for testing on Mac before/without Webhook)
// Usage: TELEGRAM_BOT_TOKEN="your_token" SITE_URL="https://your-site.netlify.app" npm run bot

import { handleTelegramUpdate } from './netlify/functions/telegram-bot.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';

if (!BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN environment variable is required.');
  console.error('Example: TELEGRAM_BOT_TOKEN="123456:ABC-DEF..." npm run bot');
  process.exit(1);
}

let offset = 0;

async function startPolling() {
  // Remove any active webhook so getUpdates polling works
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
  const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then((r) => r.json());
  console.log(
    `🤖 Telegram Bot (@${meRes.result?.username || 'bot'}) started! Listening for links...`
  );
  console.log(`🌐 Connected Website URL: ${SITE_URL}`);

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=25`
      );
      const data = await res.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          handleTelegramUpdate(update, BOT_TOKEN, SITE_URL).catch((err) =>
            console.error('Update error:', err)
          );
        }
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

startPolling();
