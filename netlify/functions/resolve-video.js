// Netlify Serverless Function Proxy: /.netlify/functions/resolve-video
// Forwards requests to a configured upstream API (Cobalt API, RapidAPI, or custom backend)
// to avoid browser CORS blocks on Netlify.

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-RapidAPI-Key, X-RapidAPI-Host',
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
    const { url, quality = '1080', format = 'mp4', removeWatermark = true, customEndpoint, apiKey } = payload;

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing video URL.' }),
      };
    }

    const endpoint = customEndpoint || process.env.UPSTREAM_VIDEO_API_URL;
    const token = apiKey || process.env.UPSTREAM_VIDEO_API_KEY;

    // If user configured an upstream Cobalt-compatible or custom JSON endpoint, forward it:
    if (endpoint) {
      const reqHeaders = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) {
        reqHeaders.Authorization = `Bearer ${token}`;
      }

      const upstreamRes = await fetch(endpoint, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          url,
          videoQuality: quality,
          downloadMode: format === 'mp3' ? 'audio' : 'auto',
          tiktokFullAudio: format === 'mp3',
          isNoTTWatermark: removeWatermark,
        }),
      });

      const data = await upstreamRes.json();
      return {
        statusCode: upstreamRes.status,
        headers,
        body: JSON.stringify(data),
      };
    }

    return {
      statusCode: 501,
      headers,
      body: JSON.stringify({
        error: 'No upstream API configured in environment variables (UPSTREAM_VIDEO_API_URL). Using client-side resolver.',
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
