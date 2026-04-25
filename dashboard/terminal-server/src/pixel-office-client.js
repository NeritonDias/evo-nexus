/* Lightweight, non-blocking pixel-office event emitter for the terminal-server. */
const http = require('node:http');
const https = require('node:https');

function postEvent(payload) {
  try {
    const baseUrl = process.env.EVONEXUS_DASHBOARD_URL || 'http://127.0.0.1:8080';
    const url = new URL('/api/pixel-office/hook', baseUrl);
    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        ...(process.env.PIXEL_OFFICE_HOOK_TOKEN ? { 'X-Hook-Token': process.env.PIXEL_OFFICE_HOOK_TOKEN } : {}),
      },
      timeout: 1500,
    };
    const req = lib.request(opts);
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();
  } catch (_) { /* swallow — visualization is best-effort */ }
}

module.exports = { postEvent };
