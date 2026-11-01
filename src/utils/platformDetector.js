export const PLATFORMS = {
  ALL: 'all',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  TELEGRAM: 'telegram',
};

export function detectPlatform(url = '') {
  const clean = url.trim().toLowerCase();
  if (!clean) return null;

  if (
    clean.includes('tiktok.com') ||
    clean.includes('vm.tiktok.com') ||
    clean.includes('vt.tiktok.com')
  ) {
    return PLATFORMS.TIKTOK;
  }

  if (
    clean.includes('youtube.com/') ||
    clean.includes('youtu.be/') ||
    clean.includes('youtube.com/shorts/')
  ) {
    return PLATFORMS.YOUTUBE;
  }

  if (
    clean.includes('t.me/') ||
    clean.includes('telegram.me/') ||
    clean.includes('telegram.dog/')
  ) {
    return PLATFORMS.TELEGRAM;
  }

  return null;
}

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

export function extractTelegramPost(url = '') {
  try {
    const parsed = new URL(url.trim());
    const parts = parsed.pathname.split('/').filter(Boolean);
    // e.g. t.me/s/channel/123 or t.me/channel/123
    if (parts[0] === 's' && parts.length >= 3) {
      return { channel: parts[1], postId: parts[2] };
    }
    if (parts.length >= 2) {
      return { channel: parts[0], postId: parts[1] };
    }
    return null;
  } catch {
    return null;
  }
}

export const SAMPLE_LINKS = {
  tiktok: 'https://www.tiktok.com/@tiktok/video/7106594312292453675',
  youtube: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  telegram: 'https://t.me/telegram/193',
};
