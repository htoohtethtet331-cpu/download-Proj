import { detectPlatform, extractYouTubeId, extractTelegramPost, PLATFORMS } from '../utils/platformDetector';

const DEFAULT_API_SETTINGS = {
  mode: 'auto', // 'auto' | 'custom'
  customEndpoint: '',
  apiKey: '',
};

export function loadApiSettings() {
  try {
    const saved = localStorage.getItem('snapfetch_api_settings');
    return saved ? { ...DEFAULT_API_SETTINGS, ...JSON.parse(saved) } : DEFAULT_API_SETTINGS;
  } catch {
    return DEFAULT_API_SETTINGS;
  }
}

export function saveApiSettings(settings) {
  localStorage.setItem('snapfetch_api_settings', JSON.stringify(settings));
}

// 1. Primary resolver: Calls our backend / Netlify Function (/api/resolve-video)
async function resolveViaServerApi(url, options, settings) {
  const endpoint =
    settings.mode === 'custom' && settings.customEndpoint
      ? settings.customEndpoint
      : '/api/resolve-video';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      url,
      quality: options.quality,
      format: options.format,
      removeWatermark: options.removeWatermark,
      customEndpoint: settings.mode === 'custom' ? settings.customEndpoint : '',
      apiKey: settings.apiKey,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server resolver returned ${res.status}`);
  }

  return await res.json();
}

// 2. Client-side TikTok resolver (TikWM public CORS-enabled API)
async function resolveTikTokClient(url) {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  const res = await fetch(apiUrl);
  const json = await res.json();

  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'Unable to fetch TikTok video metadata.');
  }

  const d = json.data;
  const formats = [];

  if (d.hdplay) {
    formats.push({
      id: 'tt-hd',
      label: 'HD No Watermark (1080p)',
      ext: 'MP4',
      size: d.hd_size ? `${(d.hd_size / (1024 * 1024)).toFixed(1)} MB` : 'HD',
      url: d.hdplay,
      badge: 'Best Quality',
    });
  }
  if (d.play) {
    formats.push({
      id: 'tt-nowm',
      label: 'Standard No Watermark (720p)',
      ext: 'MP4',
      size: d.size ? `${(d.size / (1024 * 1024)).toFixed(1)} MB` : 'SD',
      url: d.play,
      badge: 'No Watermark',
    });
  }
  if (d.wmplay) {
    formats.push({
      id: 'tt-wm',
      label: 'With Watermark',
      ext: 'MP4',
      size: d.wm_size ? `${(d.wm_size / (1024 * 1024)).toFixed(1)} MB` : 'Original',
      url: d.wmplay,
    });
  }
  if (d.music) {
    formats.push({
      id: 'tt-mp3',
      label: 'Original Audio Track',
      ext: 'MP3',
      size: 'Audio Only',
      url: d.music,
    });
  }

  return {
    platform: PLATFORMS.TIKTOK,
    title: d.title || 'TikTok Video',
    author: d.author?.nickname ? `@${d.author.unique_id} (${d.author.nickname})` : '@tiktok_creator',
    thumbnail: d.cover || d.origin_cover,
    duration: d.duration
      ? `${Math.floor(d.duration / 60)}:${String(d.duration % 60).padStart(2, '0')}`
      : '0:30',
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

// 3. Client-side YouTube fallback if static host has no serverless functions active
async function resolveYouTubeClientFallback(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error('Invalid YouTube URL.');

  // Try public Piped API instances for client-side stream resolution
  const pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.moomoo.me',
  ];

  for (const instance of pipedInstances) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`);
      if (!res.ok) continue;
      const data = await res.json();
      const formats = [];

      for (const s of (data.videoStreams || []).filter((v) => !v.videoOnly && v.url)) {
        formats.push({
          id: `piped-${s.quality}`,
          label: `MP4 Video + Audio (${s.quality})`,
          ext: s.format || 'MP4',
          size: s.quality || 'HD',
          url: s.url,
          badge: 'Direct Stream',
        });
      }
      for (const a of (data.audioStreams || []).filter((x) => x.url).slice(0, 1)) {
        formats.push({
          id: `piped-audio`,
          label: `Audio Track (${a.quality || '128kbps'})`,
          ext: 'M4A',
          size: 'Audio Only',
          url: a.url,
          badge: 'Audio',
        });
      }

      if (formats.length > 0) {
        return {
          platform: PLATFORMS.YOUTUBE,
          videoId,
          title: data.title || 'YouTube Video',
          author: data.uploader || 'YouTube Creator',
          thumbnail: data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: data.duration
            ? `${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}`
            : 'HD',
          stats: {
            views: data.views ? `${Number(data.views).toLocaleString()} views` : 'YouTube',
            likes: 'HD Stream',
          },
          sourceUrl: url,
          previewVideoUrl: formats[0]?.url,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          formats,
          isLiveResolved: true,
        };
      }
    } catch {
      // continue to next instance
    }
  }

  throw new Error('Unable to extract YouTube stream. Please ensure the video is public.');
}

// 4. Client-side Telegram fallback via CORS proxy
async function resolveTelegramClientFallback(url) {
  const post = extractTelegramPost(url);
  if (!post) throw new Error('Invalid Telegram post URL. Example: https://t.me/telegram/193');

  const embedUrl = `https://t.me/${post.channel}/${post.postId}?embed=1`;
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(embedUrl)}`;
  const res = await fetch(proxyUrl);
  const html = await res.text();

  const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
  const directVideoUrl = videoMatch ? videoMatch[1] : null;

  if (!directVideoUrl) {
    throw new Error('Could not find a public video in this Telegram post.');
  }

  return {
    platform: PLATFORMS.TELEGRAM,
    title: `Telegram Video @${post.channel} #${post.postId}`,
    author: `@${post.channel}`,
    thumbnail:
      'https://images.unsplash.com/photo-1611606063065-ee7946f0787a?w=640&auto=format&fit=crop&q=80',
    duration: 'Telegram Media',
    stats: {
      views: `t.me/${post.channel}/${post.postId}`,
      likes: 'Direct MP4',
    },
    sourceUrl: url,
    previewVideoUrl: directVideoUrl,
    formats: [
      {
        id: `tg-${post.postId}`,
        label: 'Original Telegram Video (MP4)',
        ext: 'MP4',
        size: 'Direct CDN Stream',
        url: directVideoUrl,
        badge: 'Original Quality',
      },
    ],
    isLiveResolved: true,
  };
}

export async function fetchVideoInfo(
  url,
  options = { quality: '1080', format: 'mp4', removeWatermark: true }
) {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error('Unsupported URL. Please enter a valid TikTok, YouTube, or Telegram video link.');
  }

  const settings = loadApiSettings();

  // First try server/Netlify Function endpoint (/api/resolve-video)
  try {
    const serverResult = await resolveViaServerApi(url, options, settings);
    if (serverResult && Array.isArray(serverResult.formats) && serverResult.formats.length > 0) {
      return serverResult;
    }
  } catch (err) {
    console.warn('Server API fallback triggered:', err.message);
  }

  // Client-side fallbacks if /api/resolve-video is unreachable
  if (platform === PLATFORMS.TIKTOK) {
    return await resolveTikTokClient(url);
  }

  if (platform === PLATFORMS.YOUTUBE) {
    return await resolveYouTubeClientFallback(url);
  }

  if (platform === PLATFORMS.TELEGRAM) {
    return await resolveTelegramClientFallback(url);
  }

  throw new Error('Failed to resolve video link.');
}
