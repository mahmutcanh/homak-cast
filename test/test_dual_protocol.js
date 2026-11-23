'use strict';
// Both LAN ports must answer http:// and https:// (whichever scheme the user types), incl. Socket.IO.
const assert = require('assert');
const http = require('http');
const https = require('https');
const { io: connectClient } = require('socket.io-client');
const SignalingServer = require('../server/signaling-server');

const HTTP_PORT = 5396;
const HTTPS_PORT = 5397;

function get(lib, port, path) {
  return new Promise((resolve, reject) => {
    lib.get({ host: '127.0.0.1', port, path, rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function socketPair(url) {
  return new Promise((resolve, reject) => {
    const s = connectClient(url, { transports: ['websocket'], rejectUnauthorized: false, reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

(async () => {
  const srv = new SignalingServer({ port: HTTP_PORT, httpsPort: HTTPS_PORT });
  await srv.start();
  try {
    for (const [lib, scheme] of [[http, 'http'], [https, 'https']]) {
      for (const port of [HTTP_PORT, HTTPS_PORT]) {
        const page = await get(lib, port, '/');
        assert.strictEqual(page.status, 200, `${scheme}://:${port}/ status`);
        assert.ok(/pinForm/.test(page.body), `${scheme}://:${port}/ serves the web sender`);
        const sock = await socketPair(`${scheme}://127.0.0.1:${port}`);
        assert.ok(sock.connected, `${scheme}://:${port} socket.io connects`);
        sock.disconnect();
        console.log(`  ok - ${scheme}://127.0.0.1:${port} serves page + socket.io`);
      }
    }
  } finally {
    await srv.stop();
  }
  console.log('test_dual_protocol: passed');
})().catch((err) => { console.error(err); process.exit(1); });
