import type { Context, Next } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { Env } from './util';

const COOKIE = 'ps_admin';
const MAX_AGE = 60 * 60 * 24 * 14;

const secret = (env: Env) => {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) throw new Error('SESSION_SECRET ยังไม่ได้ตั้ง หรือสั้นเกินไป');
  return env.SESSION_SECRET;
};

/** เทียบรหัสผ่านแบบเวลาคงที่ */
async function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function login(c: Context<{ Bindings: Env }>, password: string) {
  if (!c.env.ADMIN_PASSWORD || !(await safeEqual(password, c.env.ADMIN_PASSWORD))) return false;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  await setSignedCookie(c, COOKIE, String(exp), secret(c.env), {
    path: '/',
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    maxAge: MAX_AGE,
  });
  return true;
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  const v = await getSignedCookie(c, secret(c.env), COOKIE);
  if (!v || Number(v) < Date.now() / 1000) {
    const back = encodeURIComponent(new URL(c.req.url).pathname);
    return c.redirect(`/admin/login?next=${back}`);
  }
  await next();
}
