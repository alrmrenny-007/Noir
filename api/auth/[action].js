// One file handles: signup, login, logout, me, google, google-callback
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sql, ensure, cookies, sessionCookie, setSession, clearSession, getUser } = require('../_lib');

const json = (res, code, obj) => res.status(code).json(obj);

module.exports = async (req, res) => {
  const a = req.query.action;
  const origin = `https://${req.headers.host}`;
  try {
    if (!process.env.AUTH_SECRET || !process.env.DATABASE_URL) {
      return json(res, 500, { error: 'Accounts are not set up yet' });
    }
    await ensure();

    if (a === 'me') {
      const u = await getUser(req);
      return json(res, 200, { user: u ? { name: u.name, email: u.email } : null });
    }
    if (a === 'logout') {
      clearSession(res);
      return json(res, 200, { ok: true });
    }

    if (a === 'google') {
      const state = crypto.randomBytes(16).toString('hex');
      res.setHeader('Set-Cookie', `rw_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
      const q = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: `${origin}/api/auth/google-callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account'
      });
      res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
      return res.end();
    }

    if (a === 'google-callback') {
      const { code, state } = req.query;
      if (!code || !state || state !== cookies(req).rw_state) {
        res.writeHead(302, { Location: '/#/login' });
        return res.end();
      }
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${origin}/api/auth/google-callback`,
          grant_type: 'authorization_code'
        })
      });
      const tok = await tr.json();
      if (!tok.access_token) throw new Error('Google token failed');
      const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` }
      });
      const g = await ur.json();
      if (!g.email || g.email_verified === false) throw new Error('Google email not verified');
      const email = g.email.toLowerCase();
      let r = await sql`SELECT id, name, email FROM users WHERE email = ${email}`;
      if (!r.length) {
        r = await sql`INSERT INTO users (email, name, provider) VALUES (${email}, ${g.name || email.split('@')[0]}, 'google') RETURNING id, name, email`;
      }
      res.setHeader('Set-Cookie', [await sessionCookie(r[0]), 'rw_state=; Path=/; Max-Age=0']);
      res.writeHead(302, { Location: '/#/account' });
      return res.end();
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.pw || '');

    if (a === 'signup') {
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || pw.length < 8) {
        return json(res, 400, { error: 'Please enter your name, a valid email and a password of 8 or more characters' });
      }
      const ex = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (ex.length) return json(res, 409, { error: 'An account with this email already exists. Please log in.' });
      const hash = await bcrypt.hash(pw, 10);
      const r = await sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${name}, ${hash}) RETURNING id, name, email`;
      await setSession(res, r[0]);
      return json(res, 200, { user: { name: r[0].name, email: r[0].email } });
    }

    if (a === 'login') {
      const r = await sql`SELECT * FROM users WHERE email = ${email}`;
      const u = r[0];
      if (u && !u.password_hash) return json(res, 401, { error: 'This account uses Google. Tap "Continue with Google".' });
      if (!u || !(await bcrypt.compare(pw, u.password_hash))) return json(res, 401, { error: 'Wrong email or password' });
      await setSession(res, u);
      return json(res, 200, { user: { name: u.name, email: u.email } });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Something went wrong. Please try again.' });
  }
};
