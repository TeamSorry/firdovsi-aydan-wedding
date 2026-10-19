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
    throw new ApiError('Verilənlər bazası qoşulmayıb. Vercel → Settings → Environment Variables bölməsinə UPSTASH_REDIS_REST_URL və UPSTASH_REDIS_REST_TOKEN əlavə edin.', 503);
  }
  if (!/^https:\/\//i.test(url)) throw new ApiError('UPSTASH_REDIS_REST_URL düzgün HTTPS URL olmalıdır.', 503);
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
  } catch { throw new ApiError('Verilənlər bazası ilə əlaqə qurulmadı. Upstash URL və şəbəkə bağlantısını yoxlayın.', 503); }
  if (!response.ok) throw new ApiError('Verilənlər bazası sorğunu qəbul etmədi. Upstash tokenini yoxlayın.', 503);
  const data = await response.json();
  if (data.error) throw new ApiError('Verilənlər bazası xətası. Redis parametrlərini yoxlayın.', 503);
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
  if (!response.ok) throw new ApiError('Siyahını saxlamaq mümkün olmadı. Redis parametrlərini yoxlayın.', 503);
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
    const source = new URL(origin);
    if (source.host === req.headers.host && source.protocol === 'https:') return;
    if (source.hostname === 'localhost' && source.host === req.headers.host && source.protocol === 'http:') return;
  } catch { /* invalid origin */ }
  throw new ApiError('Təhlükəsizlik yoxlaması alınmadı (Origin).', 403);
}
function ensureAdmin(req, session) {
  if (!session) throw new ApiError('Admin girişi tələb olunur.', 401);
  const sent = String(req.headers['x-csrf-token'] || '');
  if (sent.length !== session.csrf.length || !timingSafeEqual(Buffer.from(sent), Buffer.from(session.csrf))) {
    throw new ApiError('Təhlükəsizlik kodu uyğun gəlmir. Səhifəni yeniləyin.', 403);
  }
}
function passwordOk(v) {
  return typeof v === 'string' && v.length >= 10 && v.length <= 128 && Buffer.byteLength(v, 'utf8') <= 256;
}
function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 240000, 32, 'sha256').toString('hex');
  return `pbkdf2-sha256:240000:${salt}:${hash}`;
}
function passwordVerify(password, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const rounds = Number(parts[1]);
  if (!Number.isInteger(rounds) || rounds < 100000 || rounds > 400000) return false;
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = pbkdf2Sync(password, salt, rounds, expected.length, 'sha256');
  return timingSafeEqual(actual, expected);
}
function installCodeOk(value) {
  const expected = process.env.ADMIN_SETUP_KEY || '';
  if (expected.length < 12 || typeof value !== 'string') return false;
  const a = createHash('sha256').update(value).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
function norm(value) {
  return String(value || '').toLocaleLowerCase('az').normalize('NFC')
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g');
}
async function readGuests() {
  const raw = await redis(['HGETALL', GUEST_KEY]);
  const result = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length - 1; i += 2) {
      try { const guest = JSON.parse(raw[i + 1]); if (guest.id && guest.name) result.push(guest); } catch { /* bad entry */ }
    }
  } else if (raw && typeof raw === 'object') {
    for (const value of Object.values(raw)) {
      try { const guest = JSON.parse(value); if (guest.id && guest.name) result.push(guest); } catch { /* bad entry */ }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'az'));
}
function extractBody(req) {
  const value = req.body;
  const size = Number(req.headers['content-length'] || 0);
  if (size > 250000) throw new ApiError('Sorğu çox böyükdür. CSV siyahısını kiçik hissələrlə göndərin.', 413);
  const body = typeof value === 'string' ? JSON.parse(value) : value;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Yanlış sorğu formatı.', 400);
  return body;
}
function validateGuest(row) {
  if (!row || typeof row.name !== 'string' || row.name.trim().length < 2 || row.name.trim().length > 150) throw new ApiError('Qonağın adını düzgün yazın (2–150 simvol).');
  const n = Number(row.tableNo);
  if (!Number.isInteger(n) || n < 1 || n > 30) throw new ApiError('Masa nömrəsi 1–30 arasında olmalıdır.');
  if (/[\u0000-\u001F\u007F]/.test(row.name)) throw new ApiError('Ad və soyadda idarəedici simvol olmamalıdır.');
  return { id: randomBytes(16).toString('hex'), name: row.name.trim(), tableNo: n, arrived: row.arrived === true };
}
function clientKey(req) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || 'unknown').split(',')[0].trim();
  return PREFIX + 'login-attempt:' + createHash('sha256').update(ip).digest('hex');
}
async function checkAttemptLimit(req) {
  const key = clientKey(req);
  const raw = await redis(['GET', key]);
  if (Number(raw || 0) >= 7) throw new ApiError('Çox sayda səhv cəhd. 15 dəqiqədən sonra yenidən yoxlayın.', 429);
}
async function failedAttempt(req) {
  const key = clientKey(req);
  const n = await redis(['INCR', key]);
  if (n === 1) await redis(['EXPIRE', key, 900]);
}

export default async function handler(req, res) {
  try {
    config();
    if (!['GET', 'POST'].includes(req.method)) throw new ApiError('Bu əməliyyata icazə verilmir.', 405);
    if (req.method === 'GET') {
      const action = String(req.query.action || '');
      if (action === 'status') {
        const [stored, session] = await Promise.all([redis(['GET', ADMIN_KEY]), auth(req)]);
        return json(res, { initialized: Boolean(stored), admin: Boolean(session), csrf: session?.csrf || '' });
      }
      if (action === 'guests') {
        const session = await auth(req);
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!session && (q.length < 2 || q.length > 100)) return json(res, { guests: [] });
        const all = await readGuests();
        const guests = session ? all : all.filter(g => norm(g.name).includes(norm(q))).slice(0, 30);
        // In guest search mode only, show name, table and arrival status.
        return json(res, { guests });
      }
      throw new ApiError('Sorğu tapılmadı.', 404);
    }
    verifyOrigin(req);
    const body = extractBody(req);
    const action = body.action;
    if (action === 'setup' || action === 'login') {
      await checkAttemptLimit(req);
      if (!passwordOk(body.password)) throw new ApiError('Parol 10–128 simvol olmalıdır.');
      const saved = await redis(['GET', ADMIN_KEY]);
      if (action === 'setup') {
        if (saved) throw new ApiError('Admin parolu artıq müəyyən edilib.', 409);
        if (!process.env.ADMIN_SETUP_KEY || process.env.ADMIN_SETUP_KEY.length < 12) throw new ApiError('Vercel-də ADMIN_SETUP_KEY əlavə edin (ən azı 12 simvol).', 503);
        if (!installCodeOk(body.installCode)) { await failedAttempt(req); throw new ApiError('Quraşdırma kodu yanlışdır.', 401); }
        const ok = await redis(['SET', ADMIN_KEY, passwordHash(body.password), 'NX']);
        if (ok !== 'OK') throw new ApiError('İlk admin parolu artıq yaradılıb.', 409);
      } else {
        if (!saved) throw new ApiError('Əvvəlcə admin parolunu quraşdırın.', 409);
        if (!passwordVerify(body.password, saved)) { await failedAttempt(req); throw new ApiError('Parol yanlışdır.', 401); }
      }
      await redis(['DEL', clientKey(req)]);
      const csrf = await establishSession(res);
      return json(res, { ok: true, csrf });
    }
    const session = await auth(req);
    ensureAdmin(req, session);
    if (action === 'logout') {
      await redis(['DEL', sessionKey(session.id)]);
      res.setHeader('Set-Cookie', cookieHeader('', 0));
      return json(res, { ok: true });
    }
    if (action === 'add') {
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 300) throw new ApiError('Bir dəfəyə 1–300 qonaq əlavə edə bilərsiniz.');
      const guests = body.rows.map(validateGuest);
      const n = await redis(['HLEN', GUEST_KEY]);
      if (Number(n) + guests.length > MAX_GUESTS) throw new ApiError('Qonaq sayı 10000 limitini keçir.');
      const cmds = guests.map(g => ['HSET', GUEST_KEY, g.id, JSON.stringify(g)]);
      await pipeline(cmds);
      return json(res, { ok: true, count: guests.length });
    }
    if (action === 'delete' || action === 'arrived' || action === 'edit') {
      if (typeof body.id !== 'string' || !/^[a-f0-9]{32}$/.test(body.id)) throw new ApiError('Yanlış qonaq ID-si.');
      if (action === 'edit') {
        const old = await redis(['HGET', GUEST_KEY, body.id]);
        if (!old) throw new ApiError('Qonaq tapılmadı.', 404);
        const changed = validateGuest({ name: body.name, tableNo: body.tableNo });
        const original = JSON.parse(old);
        await redis(['HSET', GUEST_KEY, body.id, JSON.stringify({ ...original, name: changed.name, tableNo: changed.tableNo })]);
        return json(res, { ok: true });
      }
      if (action === 'delete') {
        const n = await redis(['HDEL', GUEST_KEY, body.id]);
        if (!n) throw new ApiError('Qonaq tapılmadı.', 404);
        return json(res, { ok: true });
      }
      if (typeof body.value !== 'boolean') throw new ApiError('Yanlış qarşılanma statusu.');
      const old = await redis(['HGET', GUEST_KEY, body.id]);
      if (!old) throw new ApiError('Qonaq tapılmadı.', 404);
      const guest = JSON.parse(old);
      guest.arrived = body.value;
      await redis(['HSET', GUEST_KEY, body.id, JSON.stringify(guest)]);
      return json(res, { ok: true });
    }
    throw new ApiError('Yanlış əməliyyat.', 400);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('Toy site API error:', error);
    return json(res, { error: error instanceof ApiError ? error.message : 'Server xətası. Vercel Functions bölməsində logları yoxlayın.' }, error instanceof ApiError ? error.status : 500);
  }
}
