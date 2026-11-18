import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { Env, baht } from './lib/util';
import { cancelOrder, getSettings } from './lib/store';
import { notifyLine } from './lib/line';
import { themeVars, isDefaultTheme } from './lib/theme';
import shop from './routes/shop';
import api from './routes/api';
import admin from './routes/admin';
import { Shell, ShopHeader, ShopFooter } from './views/layout';

const app = new Hono<{ Bindings: Env }>();

app.use('*', secureHeaders({ crossOriginEmbedderPolicy: false, referrerPolicy: 'strict-origin-when-cross-origin' }));
// ฟอร์ม POST ต้องมาจากโดเมนเดียวกัน
app.use('*', csrf());
app.use('/admin/*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
  c.header('x-robots-tag', 'noindex');
});

// ใส่สีธีมที่ตั้งไว้ในหลังบ้านลงในทุกหน้า HTML
app.use('*', async (c, next) => {
  await next();
  if (!(c.res.headers.get('content-type') || '').includes('text/html')) return;
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('theme_accent','theme_leaf')")
    .all<{ key: string; value: string }>()
    .then((r) => Object.fromEntries(r.results.map((x) => [x.key, x.value])))
    .catch(() => ({}) as Record<string, string>);
  if (isDefaultTheme(rows.theme_accent, rows.theme_leaf)) return;
  const t = themeVars(rows.theme_accent, rows.theme_leaf);
  const html = (await c.res.text())
    .replace('<meta name="theme-color" content="#2f7d4f"/>', `<meta name="theme-color" content="${t.light.leaf}"/>`)
    .replace('</head>', `<style id="theme">${t.css}</style></head>`);
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  c.res = new Response(html, { status: c.res.status, headers });
});

app.route('/api', api);
app.route('/admin', admin);
app.route('/', shop);

app.get('/robots.txt', (c) => c.text(`User-agent: *\nDisallow: /admin\nDisallow: /order/\nDisallow: /api/\n`));

app.notFound(async (c) => {
  const s = await getSettings(c.env.DB).catch(() => ({ shop_name: 'Phasakura', tagline: '' }) as any);
  return c.html(
    <Shell title={`ไม่พบหน้านี้ · ${s.shop_name}`}>
      <div class="phone-wrap">
        <ShopHeader s={s} back />
        <div class="order">
          <h1>ไม่พบหน้านี้</h1>
          <p>
            ลิงก์อาจผิดหรือสินค้าถูกนำออกแล้ว <a href="/">กลับหน้าร้าน</a>
          </p>
        </div>
        <ShopFooter s={s} />
      </div>
    </Shell>,
    404,
  );
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.text('ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง', 500);
});

/** ยกเลิกออเดอร์พร้อมเพย์ที่ไม่ได้แนบสลิปเกินเวลา แล้วคืนสต็อก */
async function cancelUnpaid(env: Env) {
  const s = await getSettings(env.DB);
  const hours = Math.max(1, parseInt(s.unpaid_cancel_hours || '24', 10) || 24);
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, order_no, total FROM orders WHERE status = 'awaiting_payment' AND payment_status = 'awaiting' AND created_at < ? LIMIT 100`,
  )
    .bind(cutoff)
    .all<{ id: number; order_no: string; total: number }>();
  const done: string[] = [];
  for (const o of results) if (await cancelOrder(env.DB, o.id, `ไม่ชำระเงินภายใน ${hours} ชม.`)) done.push(`${o.order_no} (${baht(o.total)})`);
  if (done.length) await notifyLine(env, `ยกเลิกอัตโนมัติ ${done.length} ออเดอร์ที่ไม่ชำระเงิน และคืนสต็อกแล้ว\n${done.join('\n')}`);
}

export default {
  fetch: app.fetch,
  scheduled: (_e: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(cancelUnpaid(env)),
} satisfies ExportedHandler<Env>;
