/**
 * Firdovsi & Aydan — Vercel Node.js Function
 * Database: Upstash Redis REST API. No PHP, local filesystem writes, or npm dependencies.
 * Secrets are provided only through Vercel Environment Variables.
 */
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';

const PREFIX = 'firdovsi-aydan:v1:';
const ADMIN_KEY = PREFIX + 'admin';
const GUEST_KEY = PREFIX + 'guests';
const SESSION_SECONDS = 60 * 60 * 12;
const COOKIE_NAME = 'firdovsi_admin_session';
const MAX_GUESTS = 10000;

class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

function config() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) {
    throw new ApiError('Verilənlər bazası qoşulmayıb.', 503);
  }
  if (!/^https:\/\//i.test(url)) throw new ApiError('Verilənlər bazası ünvanı düzgün deyil.', 503);
  return { url, token };
}

async function redis(cmd) {
  const { url, token } = config();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(9000),
    });
  } catch { throw new ApiError('Verilənlər bazası ilə əlaqə qurulmadı.', 503); }
  if (!response.ok) throw new ApiError('Verilənlər bazası sorğunu qəbul etmədi.', 503);
  const data = await response.json();
  if (data.error) throw new ApiError('Verilənlər bazası xətası.', 503);
  return data.result;
}

async function pipeline(commands) {
  const { url, token } = config();
  let response;
  try {
    response = await fetch(url + '/pipeline', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new ApiError('Siyahı saxlanarkən bağlantı xətası baş verdi.', 503); }
  if (!response.ok) throw new ApiError('Siyahını saxlamaq mümkün olmadı.', 503);
  const results = await response.json();
  if (!Array.isArray(results) || results.length !== commands.length || results.some(item => item.error)) {
    throw new ApiError('Siyahının saxlanması tamamlana bilmədi. Əlavə etdiyiniz sətirləri yoxlayın.', 503);
  }
  return results.map(x => x.result);
}

const sessionKey = token => PREFIX + 'session:' + token;
function cookie(req) {
  const raw = String(req.headers.cookie || '');
  const key = raw.split(';').map(p => p.trim()).find(p => p.startsWith(COOKIE_NAME + '='));
  if (!key) return '';
  const value = key.slice(COOKIE_NAME.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
function cookieHeader(token, age) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${age}`;
}
async function auth(req) {
  const id = cookie(req);
  if (!id) return null;
  const raw = await redis(['GET', sessionKey(id)]);
  if (!raw) return null;
  try { const value = JSON.parse(raw); return { id, csrf: value.csrf }; }
  catch { return null; }
}
async function establishSession(res) {
  const id = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  await redis(['SET', sessionKey(id), JSON.stringify({ csrf }), 'EX', SESSION_SECONDS]);
  res.setHeader('Set-Cookie', cookieHeader(id, SESSION_SECONDS));
  return csrf;
}
function verifyOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // For non-browser clients; admins must also supply a CSRF token.
  try {
