import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveVideoPayload } from './netlify/functions/resolve-video.js';
import { handler as telegramBotHandler } from './netlify/functions/telegram-bot.js';
import https from 'node:https';
import http from 'node:http';

function localApiPlugin() {
  return {
    name: 'local-netlify-api-middleware',
    configureServer(server) {
      // 1. /api/resolve-video endpoint (mirrors Netlify Function locally)
      server.middlewares.use('/api/resolve-video', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          });
          return res.end();
        }
        if (req.method !== 'POST') return next();

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const data = await resolveVideoPayload(payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Resolver error' }));
          }
        });
      });

      // 2. /api/telegram-bot endpoint (mirrors Netlify Telegram Bot Function locally)
      server.middlewares.use('/api/telegram-bot', (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const reqUrl = new URL(req.url, 'http://localhost');
            const queryStringParameters = Object.fromEntries(reqUrl.searchParams.entries());
            const result = await telegramBotHandler({
              httpMethod: req.method,
              queryStringParameters,
              body,
            });
            res.writeHead(result.statusCode || 200, result.headers || { 'Content-Type': 'application/json' });
            res.end(result.body);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // 3. /api/stream endpoint (proxies video/audio download with Content-Disposition: attachment)
      server.middlewares.use('/api/stream', (req, res) => {
        try {
          const reqUrl = new URL(req.url, 'http://localhost');
          const targetUrl = reqUrl.searchParams.get('url');
          const filename = reqUrl.searchParams.get('filename') || 'video.mp4';

          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing url parameter' }));
          }

          const proxyDownload = (urlToFetch, redirectsLeft = 5) => {
            if (redirectsLeft <= 0) {
              res.writeHead(502);
              return res.end('Too many redirects');
            }
            const parsedTarget = new URL(urlToFetch);
            const client = parsedTarget.protocol === 'https:' ? https : http;

            const upstreamReq = client.get(
              urlToFetch,
              {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                  Referer: `${parsedTarget.protocol}//${parsedTarget.host}/`,
                },
              },
              (upstreamRes) => {
                if (
                  upstreamRes.statusCode >= 300 &&
                  upstreamRes.statusCode < 400 &&
                  upstreamRes.headers.location
                ) {
                  const nextUrl = new URL(upstreamRes.headers.location, urlToFetch).toString();
                  upstreamRes.resume();
                  return proxyDownload(nextUrl, redirectsLeft - 1);
                }

                const headers = {
                  'Content-Type': upstreamRes.headers['content-type'] || 'application/octet-stream',
                  'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
                  'Access-Control-Allow-Origin': '*',
                };
                if (upstreamRes.headers['content-length']) {
                  headers['Content-Length'] = upstreamRes.headers['content-length'];
                }

                res.writeHead(upstreamRes.statusCode || 200, headers);
                upstreamRes.pipe(res);
              }
            );

            upstreamReq.on('error', (err) => {
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          };

          proxyDownload(targetUrl);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
