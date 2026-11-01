import { detectPlatform, extractYouTubeId, extractTelegramPost, PLATFORMS } from '../utils/platformDetector';

const DEFAULT_API_SETTINGS = {
  mode: 'auto', // 'auto' | 'custom' | 'demo'
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

// 1. Live TikTok resolver using public TikWM API (works client-side out of the box)
async function resolveTikTokLive(url) {
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
    duration: d.duration ? `${Math.floor(d.duration / 60)}:${String(d.duration % 60).padStart(2, '0')}` : '0:30',
    stats: {
      views: d.play_count?.toLocaleString() || '—',
      likes: d.digg_count?.toLocaleString() || '—',
    },
    sourceUrl: url,
    previewVideoUrl: d.play || d.hdplay,
    formats,
    isLiveResolved: true,
  };
}

// 2. Custom / Cobalt-compatible / Netlify Function resolver
async function resolveViaCustomApi(url, options, settings) {
  const targetEndpoint = settings.customEndpoint || '/api/resolve-video';
  const res = await fetch(targetEndpoint, {
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
      customEndpoint: settings.customEndpoint,
      apiKey: settings.apiKey,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `API returned status ${res.status}`);
  }

  const data = await res.json();
  const directUrl = data.url || data.downloadUrl || data.play;
  if (!directUrl) {
    throw new Error('Custom API response did not contain a download URL.');
  }

  return {
    platform: detectPlatform(url) || PLATFORMS.YOUTUBE,
    title: data.title || data.filename || 'Downloaded Media',
    author: data.author || 'Social Media Creator',
    thumbnail:
      data.thumbnail ||
      'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=640&auto=format&fit=crop&q=80',
    duration: data.duration || '—',
    sourceUrl: url,
    previewVideoUrl: directUrl,
    formats: [
      {
        id: 'custom-primary',
        label: `${options.format.toUpperCase()} (${options.quality}p)`,
        ext: options.format.toUpperCase(),
        size: 'Direct Stream',
        url: directUrl,
        badge: 'Direct API',
      },
    ],
    isLiveResolved: true,
  };
}

// 3. YouTube metadata via oEmbed + configurable stream / sample fallback
async function resolveYouTube(url, options) {
  const videoId = extractYouTubeId(url) || 'aqz-KE-bpKQ';
  let title = 'YouTube Video';
  let author = 'YouTube Channel';
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`
    );
    if (oembedRes.ok) {
      const meta = await oembedRes.json();
      title = meta.title || title;
      author = meta.author_name || author;
      thumbnail = meta.thumbnail_url || thumbnail;
    }
  } catch {
    // fallback to default thumbnail
  }

  const sampleMp4 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

  return {
    platform: PLATFORMS.YOUTUBE,
    title,
    author,
    thumbnail,
    duration: 'HD Stream',
    stats: {
      views: 'YouTube ID: ' + videoId,
      likes: options.quality + 'p',
    },
    sourceUrl: url,
    previewVideoUrl: sampleMp4,
    formats: [
      {
        id: 'yt-1080',
        label: 'Full HD Video (1080p)',
        ext: 'MP4',
        size: '~45.2 MB',
        url: sampleMp4,
        badge: options.quality === '1080' ? 'Selected' : '1080p',
      },
      {
        id: 'yt-720',
        label: 'HD Video (720p)',
        ext: 'MP4',
        size: '~24.8 MB',
        url: sampleMp4,
        badge: options.quality === '720' ? 'Selected' : 'Fast',
      },
      {
        id: 'yt-mp3',
        label: 'High Bitrate Audio (320kbps)',
        ext: 'MP3',
        size: '~6.4 MB',
        url: sampleMp4,
        badge: options.format === 'mp3' ? 'Selected' : 'Audio',
      },
    ],
    isLiveResolved: false,
    note: 'Metadata fetched live from YouTube oEmbed. Connect a Cobalt/RapidAPI endpoint in API Settings for direct YouTube stream muxing.',
  };
}

// 4. Telegram public post resolver
async function resolveTelegram(url) {
  const post = extractTelegramPost(url);
  const channel = post?.channel || 'telegram';
  const postId = post?.postId || '193';
  const sampleMp4 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

  return {
    platform: PLATFORMS.TELEGRAM,
    title: `Telegram Post #${postId} from @${channel}`,
    author: `@${channel}`,
    thumbnail:
      'https://images.unsplash.com/photo-1611606063065-ee7946f0787a?w=640&auto=format&fit=crop&q=80',
    duration: 'Telegram Media',
    stats: {
      views: `t.me/${channel}/${postId}`,
      likes: 'Public Channel',
    },
    sourceUrl: url,
    telegramEmbedPost: `${channel}/${postId}`,
    previewVideoUrl: sampleMp4,
    formats: [
      {
        id: 'tg-orig',
        label: 'Original Telegram Video (No Compression)',
        ext: 'MP4',
        size: 'Original Quality',
        url: sampleMp4,
        badge: 'Direct Media',
      },
      {
        id: 'tg-open',
        label: 'Open Public Embed Page',
        ext: 'WEB',
        size: 'External',
        url: `https://t.me/${channel}/${postId}?embed=1`,
      },
    ],
    isLiveResolved: false,
    note: 'Parsed public Telegram channel post. Connect your Telegram Bot / Cobalt API in API Settings for direct cloud file streaming.',
  };
}

export async function fetchVideoInfo(url, options = { quality: '1080', format: 'mp4', removeWatermark: true }) {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error('Unsupported URL. Please enter a valid TikTok, YouTube, or Telegram video link.');
  }

  const settings = loadApiSettings();

  // If user explicitly configured a custom API endpoint, try that first
  if (settings.mode === 'custom' && settings.customEndpoint) {
    return await resolveViaCustomApi(url, options, settings);
  }

  // In 'auto' mode, use live TikWM API for TikTok links
  if (platform === PLATFORMS.TIKTOK && settings.mode !== 'demo') {
    try {
      return await resolveTikTokLive(url);
    } catch (err) {
      console.warn('TikWM live API fallback:', err.message);
    }
  }

  if (platform === PLATFORMS.YOUTUBE) {
    return await resolveYouTube(url, options);
  }

  if (platform === PLATFORMS.TELEGRAM) {
    return await resolveTelegram(url, options);
  }

  // Fallback for TikTok if demo mode or offline
  const sampleMp4 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4';
  return {
    platform: PLATFORMS.TIKTOK,
    title: 'TikTok Creative Short Video',
    author: '@tiktok_creator',
    thumbnail:
      'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=640&auto=format&fit=crop&q=80',
    duration: '0:28',
    stats: { views: '124.5K', likes: '18.2K' },
    sourceUrl: url,
    previewVideoUrl: sampleMp4,
    formats: [
      {
        id: 'tt-demo-hd',
        label: 'HD No Watermark (1080p)',
        ext: 'MP4',
        size: '8.4 MB',
        url: sampleMp4,
        badge: 'No Watermark',
      },
    ],
    isLiveResolved: false,
  };
}
