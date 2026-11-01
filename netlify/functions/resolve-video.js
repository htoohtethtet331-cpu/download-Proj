// Netlify Serverless Function & Vite Middleware Handler: /api/resolve-video
// Resolves real video streams for YouTube (InnerTube + Piped fallback), TikTok (TikWM), and Telegram (?embed=1 parser).

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function extractYouTubeId(url = '') {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0];
    }
    if (parsed.pathname.includes('/shorts/')) {
      return parsed.pathname.split('/shorts/')[1]?.split(/[/?#]/)[0];
    }
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

export function formatBytes(bytes) {
  const num = Number(bytes);
  if (!num || isNaN(num)) return null;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const sec = Number(seconds);
  if (!sec || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function probeContentLength(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const len = res.headers.get('content-length');
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

// 1. Resolve YouTube via InnerTube Player API (ANDROID_VR & IOS clients return direct MP4/M4A URLs)
async function resolveYouTubeInnerTube(videoId) {
  const clients = [
    {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12',
      userAgent:
        'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
    },
    {
      clientName: 'IOS',
      clientVersion: '19.45.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.1.0.22B83',
      userAgent:
        'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'X-YouTube-Client-Name': client.clientName === 'IOS' ? '5' : '28',
          'X-YouTube-Client-Version': client.clientVersion,
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              androidSdkVersion: client.androidSdkVersion,
              deviceMake: client.deviceMake,
              deviceModel: client.deviceModel,
              osName: client.osName,
              osVersion: client.osVersion,
              hl: 'en',
              gl: 'US',
            },
          },
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();

      if (data.playabilityStatus?.status !== 'OK' || !data.streamingData) {
        continue;
      }

      const details = data.videoDetails || {};
      const muxed = (data.streamingData.formats || []).filter((f) => f.url);
      const adaptive = (data.streamingData.adaptiveFormats || []).filter((f) => f.url);

      const formats = [];

      // First add muxed (video + audio combined MP4s, e.g., 720p, 360p)
      for (const f of muxed.sort((a, b) => (b.height || 0) - (a.height || 0))) {
        const qLabel = f.qualityLabel || `${f.height || 360}p`;
        const sizeBytes = f.contentLength ? Number(f.contentLength) : null;
        formats.push({
          id: `yt-muxed-${f.itag}`,
          label: `MP4 Video + Audio (${qLabel})`,
          ext: 'MP4',
          quality: String(f.height || 360),
          sizeBytes,
          size: formatBytes(sizeBytes) || 'Direct MP4',
          url: f.url,
          hasAudio: true,
          badge: f.height >= 720 ? 'HD + Audio' : 'With Audio',
        });
      }

      // Add high-res adaptive MP4 video streams (1080p / 720p) if not already in muxed
      const seenHeights = new Set(muxed.map((m) => m.height));
      for (const f of adaptive
        .filter((a) => a.mimeType?.includes('video/mp4') && a.height && !seenHeights.has(a.height))
        .sort((a, b) => (b.height || 0) - (a.height || 0))) {
        if (f.height >= 480 && f.height <= 1080) {
          seenHeights.add(f.height);
          const sizeBytes = f.contentLength ? Number(f.contentLength) : null;
          formats.push({
            id: `yt-adaptive-${f.itag}`,
            label: `Full HD Video (${f.qualityLabel || f.height + 'p'})`,
            ext: 'MP4',
            quality: String(f.height),
            sizeBytes,
            size: formatBytes(sizeBytes) || `${f.height}p Stream`,
            url: f.url,
            hasAudio: false,
            badge: f.height === 1080 ? '1080p HD' : `${f.height}p`,
          });
        }
      }

      // Add best audio stream (M4A / MP3)
      const audioStreams = adaptive
        .filter((a) => a.mimeType?.includes('audio/mp4') || a.mimeType?.includes('audio/webm'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audioStreams.length > 0) {
        const bestAudio = audioStreams[0];
        const sizeBytes = bestAudio.contentLength ? Number(bestAudio.contentLength) : null;
        formats.push({
          id: `yt-audio-${bestAudio.itag}`,
          label: `High Quality Audio (${Math.round((bestAudio.bitrate || 128000) / 1000)}kbps)`,
          ext: 'M4A',
          quality: 'audio',
          sizeBytes,
          size: formatBytes(sizeBytes) || 'Audio Only',
          url: bestAudio.url,
          hasAudio: true,
          badge: 'Audio Track',
        });
      }

      if (formats.length > 0) {
        const thumbs = details.thumbnail?.thumbnails || [];
        const bestThumb =
          thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return {
          platform: 'youtube',
          videoId,
          title: details.title || 'YouTube Video',
          author: details.author || 'YouTube Creator',
          thumbnail: bestThumb,
          duration: formatDuration(details.lengthSeconds),
          stats: {
            views: details.viewCount
              ? `${Number(details.viewCount).toLocaleString()} views`
              : 'YouTube',
            likes: muxed[0]?.qualityLabel || 'HD',
          },
          previewVideoUrl: muxed[0]?.url || formats[0]?.url,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          formats,
          isLiveResolved: true,
        };
      }
    } catch {
      // try next client
    }
  }

  return null;
}

// 2. Resolve Telegram public video post by parsing https://t.me/<channel>/<id>?embed=1
async function resolveTelegramEmbed(url) {
  const parsed = new URL(url.trim());
  const parts = parsed.pathname.split('/').filter(Boolean);
  let channel = 'telegram';
  let postId = '193';
  if (parts[0] === 's' && parts.length >= 3) {
    channel = parts[1];
    postId = parts[2];
  } else if (parts.length >= 2) {
    channel = parts[0];
    postId = parts[1];
  }

  const embedUrl = `https://t.me/${channel}/${postId}?embed=1`;
  const res = await fetch(embedUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  const html = await res.text();

  const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
  const thumbMatch =
    html.match(/tgme_widget_message_video_thumb[^>]+background-image:url\(['"]([^'"]+)['"]\)/i) ||
    html.match(/background-image:url\(['"](https:\/\/cdn[^'"]+)['"]\)/i);
  const authorMatch = html.match(
    /tgme_widget_message_owner_name[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i
  );
  const textMatch = html.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
  const durationMatch = html.match(
    /<time[^>]+class=["']tgme_widget_message_video_duration["'][^>]*>([^<]+)<\/time>/i
  );

  const cleanTitle = textMatch
    ? textMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
    : `Telegram Video @${channel} #${postId}`;

  const directVideoUrl = videoMatch ? videoMatch[1] : null;
  const thumbnail = thumbMatch
    ? thumbMatch[1]
    : 'https://images.unsplash.com/photo-1611606063065-ee7946f0787a?w=640&auto=format&fit=crop&q=80';

  const formats = [];
  if (directVideoUrl) {
    const sizeBytes = await probeContentLength(directVideoUrl);
    formats.push({
      id: `tg-mp4-${postId}`,
      label: 'Original Telegram Video (MP4)',
      ext: 'MP4',
      sizeBytes,
      size: formatBytes(sizeBytes) || 'Direct CDN Stream',
      url: directVideoUrl,
      hasAudio: true,
      badge: 'Original Quality',
    });
  }

  return {
    platform: 'telegram',
    title: cleanTitle || `Telegram Post #${postId}`,
    author: authorMatch ? `${authorMatch[1].trim()} (@${channel})` : `@${channel}`,
    thumbnail,
    duration: durationMatch ? durationMatch[1].trim() : 'Telegram Video',
    stats: {
      views: `t.me/${channel}/${postId}`,
      likes: directVideoUrl ? 'Direct MP4 Ready' : 'Public Post',
    },
    sourceUrl: url,
    previewVideoUrl: directVideoUrl,
    formats,
    isLiveResolved: Boolean(directVideoUrl),
    note: directVideoUrl
      ? null
      : 'This Telegram post does not contain a direct public video stream (or is a private/restricted file).',
  };
}

// 3. Resolve TikTok via TikWM API
async function resolveTikTok(url) {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  const res = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
  const json = await res.json();

  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'Unable to fetch TikTok video.');
  }

  const d = json.data;
  const formats = [];

  if (d.hdplay) {
    const sizeBytes = d.hd_size ? Number(d.hd_size) : null;
    formats.push({
      id: 'tt-hd',
      label: 'HD No Watermark (1080p)',
      ext: 'MP4',
      sizeBytes,
      size: formatBytes(sizeBytes) || 'HD',
      url: d.hdplay,
      hasAudio: true,
      badge: 'Best Quality',
    });
  }
  if (d.play) {
    const sizeBytes = d.size ? Number(d.size) : null;
    formats.push({
      id: 'tt-nowm',
      label: 'Standard No Watermark (720p)',
      ext: 'MP4',
      sizeBytes,
      size: formatBytes(sizeBytes) || 'SD',
      url: d.play,
      hasAudio: true,
      badge: 'No Watermark',
    });
  }
  if (d.wmplay) {
    const sizeBytes = d.wm_size ? Number(d.wm_size) : null;
    formats.push({
      id: 'tt-wm',
      label: 'With Watermark',
      ext: 'MP4',
      sizeBytes,
      size: formatBytes(sizeBytes) || 'Original',
      url: d.wmplay,
      hasAudio: true,
    });
  }
  if (d.music) {
    formats.push({
      id: 'tt-mp3',
      label: 'Original Audio Track',
      ext: 'MP3',
      sizeBytes: null,
      size: 'Audio Only',
      url: d.music,
      hasAudio: true,
    });
  }

  return {
    platform: 'tiktok',
    title: d.title || 'TikTok Video',
    author: d.author?.nickname ? `@${d.author.unique_id} (${d.author.nickname})` : '@tiktok_creator',
    thumbnail: d.cover || d.origin_cover,
    duration: formatDuration(d.duration),
    stats: {
      views: d.play_count ? `${Number(d.play_count).toLocaleString()} views` : '—',
      likes: d.digg_count ? `${Number(d.digg_count).toLocaleString()} likes` : '—',
    },
    sourceUrl: url,
    previewVideoUrl: d.play || d.hdplay,
    formats,
    isLiveResolved: true,
  };
}

export async function resolveVideoPayload(payload = {}) {
  const { url, customEndpoint, apiKey } = payload;
  if (!url) {
    throw new Error('Missing video URL.');
  }

  const clean = url.trim().toLowerCase();

  if (customEndpoint) {
    const reqHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (apiKey) reqHeaders.Authorization = `Bearer ${apiKey}`;
    const upstreamRes = await fetch(customEndpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload),
    });
    return await upstreamRes.json();
  }

  if (
    clean.includes('youtube.com/') ||
    clean.includes('youtu.be/') ||
    clean.includes('youtube.com/shorts/')
  ) {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Invalid YouTube video URL.');

    const resolved = await resolveYouTubeInnerTube(videoId);
    if (resolved) {
      return { ...resolved, sourceUrl: url };
    }
    throw new Error('Could not extract direct YouTube stream for this video.');
  }

  if (clean.includes('tiktok.com')) {
    return await resolveTikTok(url);
  }

  if (clean.includes('t.me/') || clean.includes('telegram.me/') || clean.includes('telegram.dog/')) {
    return await resolveTelegramEmbed(url);
  }

  throw new Error('Unsupported platform URL.');
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const result = await resolveVideoPayload(payload);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Failed to resolve video.' }),
    };
  }
};
