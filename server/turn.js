const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

/**
 * Build TURN iceServers entries using coturn "use-auth-secret" (TURN REST API)
 * time-limited credentials. Returns [] when TURN is not configured.
 *
 * Env:
 *   TURN_SECRET  shared secret (must match coturn static-auth-secret)
 *   TURN_URLS    comma separated, e.g. "turn:1.2.3.4:3478?transport=udp,turn:1.2.3.4:3478?transport=tcp"
 *   TURN_TTL     credential lifetime in seconds (optional)
 */
function buildTurnServers(env = process.env, now = Date.now()) {
  const secret = env.TURN_SECRET;
  const urls = (env.TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (!secret || urls.length === 0) return [];

  const ttl = Number(env.TURN_TTL) > 0 ? Number(env.TURN_TTL) : DEFAULT_TTL_SECONDS;
  const username = String(Math.floor(now / 1000) + ttl);
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return [{ urls, username, credential }];
}

module.exports = { buildTurnServers };
