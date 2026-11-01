// Netlify Serverless Function & Bot Handler: /api/telegram-bot
// Handles Telegram Bot Webhook updates + Webhook registration:
// - If video <= 50 MB: sends the actual video file directly to Telegram chat + Website link
// - If video > 50 MB: sends Direct Download links + Website link (with ?url= auto-filled)

import { resolveVideoPayload, probeContentLength, formatBytes } from './resolve-video.js';

const MAX_TELEGRAM_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

function extractFirstUrl(text = '') {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

async function tgApi(botToken, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await res.json();
}

export async function handleTelegramUpdate(update, botToken, siteBaseUrl) {
  const message = update?.message || update?.edited_message;
  if (!message || !message.chat?.id) return { ok: true };

  const chatId = message.chat.id;
  const text = (message.text || message.caption || '').trim();
  const cleanSiteUrl = (siteBaseUrl || process.env.URL || 'https://snapfetch.netlify.app').replace(
    /\/$/,
    ''
  );

  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tgApi(botToken, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `👋 <b>SnapFetch Video Downloader Bot သို့ ကြိုဆိုပါတယ်!</b>\n\n` +
        `TikTok, YouTube သို့မဟုတ် Telegram Video Link တစ်ခုခု ပို့ပေးလိုက်ပါ —\n` +
        `• <b>50 MB အောက်</b> ဖြစ်ပါက Video ဖိုင်ကို Chat ထဲသို့ တိုက်ရိုက် ပို့ပေးပါမည်။\n` +
        `• <b>50 MB အထက်</b> ဖြစ်ပါက တိုက်ရိုက် Download ဆွဲရန် Link နှင့် Website Link ပြန်ပို့ပေးပါမည်။`,
      reply_markup: {
        inline_keyboard: [[{ text: '🌐 Open SnapFetch Website', url: cleanSiteUrl }]],
      },
    });
    return { ok: true };
  }

  const videoUrl = extractFirstUrl(text);
  if (!videoUrl) {
    await tgApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: '⚠️ ကျေးဇူးပြု၍ TikTok, YouTube သို့မဟုတ် Telegram video link တစ်ခု ပို့ပေးပါ။',
    });
    return { ok: true };
  }

  // Send status message while resolving
  const statusMsg = await tgApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: '⏳ Video အချက်အလက်နှင့် File Size ကို စစ်ဆေးနေပါသည်...',
  });

  try {
    const info = await resolveVideoPayload({ url: videoUrl });
    const webAppLink = `${cleanSiteUrl}/?url=${encodeURIComponent(videoUrl)}`;

    // Pick best MP4 stream with audio (or first MP4 format)
    const mp4Formats = (info.formats || []).filter((f) => f.ext === 'MP4');
    const primaryFormat =
      mp4Formats.find((f) => f.hasAudio !== false) || mp4Formats[0] || info.formats?.[0];

    if (!primaryFormat || !primaryFormat.url) {
      throw new Error('Download stream ရှာမတွေ့ပါ။');
    }

    // Determine exact byte size (from metadata or HEAD request)
    let sizeBytes = primaryFormat.sizeBytes;
    if (!sizeBytes) {
      sizeBytes = await probeContentLength(primaryFormat.url);
    }

    const sizeLabel = sizeBytes ? formatBytes(sizeBytes) : primaryFormat.size || 'Unknown Size';
    const isUnder50MB = sizeBytes ? sizeBytes <= MAX_TELEGRAM_VIDEO_BYTES : true;

    const inlineButtons = [
      [
        {
          text: `⬇️ Direct Download (${primaryFormat.label})`,
          url: primaryFormat.url,
        },
      ],
      [
        {
          text: '🌐 Website တွင် ဖွင့်ပြီး Download ဆွဲရန်',
          url: webAppLink,
        },
      ],
    ];

    // Add extra format buttons if available (up to 2 more)
    const extraFormats = (info.formats || [])
      .filter((f) => f.id !== primaryFormat.id && f.url)
      .slice(0, 2);
    for (const extra of extraFormats) {
      inlineButtons.splice(1, 0, [
        {
          text: `📥 ${extra.label} (${extra.size || extra.ext})`,
          url: extra.url,
        },
      ]);
    }

    if (isUnder50MB) {
      // <= 50 MB: Send actual video file directly in Telegram chat!
      const videoRes = await tgApi(botToken, 'sendVideo', {
        chat_id: chatId,
        video: primaryFormat.url,
        caption:
          `🎬 <b>${escapeHtml(info.title)}</b>\n` +
          `👤 ${escapeHtml(info.author || '')}\n` +
          `📦 ဖိုင်ပမာဏ: <b>${sizeLabel}</b> (≤ 50 MB • Direct Video)\n\n` +
          `🌐 Website: <a href="${webAppLink}">SnapFetch Web Downloader</a>`,
        parse_mode: 'HTML',
        supports_streaming: true,
        reply_markup: { inline_keyboard: inlineButtons },
      });

      // If Telegram server couldn't fetch the remote stream directly (e.g. IP-bound YouTube stream),
      // gracefully send the thumbnail + direct download & website links
      if (!videoRes.ok) {
        await tgApi(botToken, 'sendPhoto', {
          chat_id: chatId,
          photo: info.thumbnail,
          caption:
            `🎬 <b>${escapeHtml(info.title)}</b>\n` +
            `👤 ${escapeHtml(info.author || '')}\n` +
            `📦 ဖိုင်ပမာဏ: <b>${sizeLabel}</b>\n\n` +
            `အောက်ပါ ခလုတ်များမှတစ်ဆင့် Video ကို တိုက်ရိုက် Download ဆွဲနိုင်ပါသည် 👇`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineButtons },
        });
      }
    } else {
      // > 50 MB: Send Direct Download Link + Website Link (as requested!)
      await tgApi(botToken, 'sendPhoto', {
        chat_id: chatId,
        photo: info.thumbnail,
        caption:
          `🎬 <b>${escapeHtml(info.title)}</b>\n` +
          `👤 ${escapeHtml(info.author || '')}\n` +
          `📦 ဖိုင်ပမာဏ: <b>${sizeLabel}</b> (⚠️ 50 MB အထက် ဖြစ်သည့်အတွက် Download Link ပို့ပေးထားပါသည်)\n\n` +
          `အောက်ပါ Direct Link သို့မဟုတ် Website မှတစ်ဆင့် အမြန် Download ဆွဲနိုင်ပါသည် 👇`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineButtons },
      });
    }
  } catch (err) {
    const webAppLink = `${cleanSiteUrl}/?url=${encodeURIComponent(videoUrl)}`;
    await tgApi(botToken, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `❌ <b>တိုက်ရိုက် ဆွဲထုတ်ရာတွင် အခက်အခဲရှိပါသည်</b>: ${escapeHtml(err.message)}\n\n` +
        `🌐 အောက်ပါ Website Link ကိုနှိပ်ပြီး Website ပေါ်တွင် တိုက်ရိုက် Download ဆွဲနိုင်ပါသည် 👇`,
      reply_markup: {
        inline_keyboard: [[{ text: '🌐 Website တွင် Download ဆွဲရန်', url: webAppLink }]],
      },
    });
  } finally {
    if (statusMsg?.result?.message_id) {
      await tgApi(botToken, 'deleteMessage', {
        chat_id: chatId,
        message_id: statusMsg.result.message_id,
      }).catch(() => {});
    }
  }

  return { ok: true };
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const query = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // Action 1: Register Webhook from the React UI
    if (body.action === 'setWebhook') {
      const token = body.botToken || process.env.TELEGRAM_BOT_TOKEN;
      const siteUrl = (body.siteUrl || process.env.URL || '').replace(/\/$/, '');
      if (!token || !siteUrl) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Bot Token နှင့် Netlify Website URL လိုအပ်ပါသည်။' }),
        };
      }
      const webhookUrl = `${siteUrl}/.netlify/functions/telegram-bot?token=${encodeURIComponent(token)}&site=${encodeURIComponent(siteUrl)}`;
      const tgRes = await tgApi(token, 'setWebhook', { url: webhookUrl });
      const meRes = await tgApi(token, 'getMe', {});
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: tgRes.ok,
          description: tgRes.description,
          webhookUrl,
          botInfo: meRes.result || null,
        }),
      };
    }

    // Action 2: Incoming Telegram Webhook Update
    const botToken = query.token || process.env.TELEGRAM_BOT_TOKEN;
    const siteBaseUrl = query.site || process.env.URL || 'https://snapfetch.netlify.app';

    if (!botToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing TELEGRAM_BOT_TOKEN' }),
      };
    }

    await handleTelegramUpdate(body, botToken, siteBaseUrl);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 200, // Always return 200 to Telegram so it doesn't retry endlessly
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
