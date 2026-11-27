// Shared helpers: database, tables and login sessions.
const { neon } = require('@neondatabase/serverless');
const { SignJWT, jwtVerify } = require('jose');

const sql = neon(process.env.DATABASE_URL || 'postgres://missing');
let ready = null;
const ensure = () =>
  ready ||
  (ready = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT, provider TEXT DEFAULT 'email', created_at TIMESTAMPTZ DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, tx_ref TEXT UNIQUE NOT NULL, user_id INT, email TEXT, items JSONB, amount NUMERIC, currency TEXT, address TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now())`;
  })().catch((e) => {
    ready = null;
    throw e;
  }));

const key = () => new TextEncoder().encode(process.env.AUTH_SECRET || '');
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map((p) => [p[0], p.slice(1).join('=')])
  );

async function sessionCookie(user) {
  const t = await new SignJWT({ uid: user.id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('30d').sign(key());
  return `rw_session=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}
async function setSession(res, user) {
  res.setHeader('Set-Cookie', await sessionCookie(user));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'rw_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}
async function getUser(req) {
  try {
    const t = cookies(req).rw_session;
    if (!t) return null;
    const { payload } = await jwtVerify(t, key());
    const r = await sql`SELECT id, name, email FROM users WHERE id = ${payload.uid}`;
    return r[0] || null;
  } catch (e) {
    return null;
  }
}
module.exports = { sql, ensure, cookies, sessionCookie, setSession, clearSession, getUser };
