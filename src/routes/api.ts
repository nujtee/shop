import { Hono } from 'hono';
import { Env, baht } from '../lib/util';
import { getSettings, quote, createOrder, CheckoutError, CheckoutInput } from '../lib/store';
import { notifyLine } from '../lib/line';

const app = new Hono<{ Bindings: Env }>();

const publicQuote = (q: Awaited<ReturnType<typeof quote>>) => ({
  lines: q.lines.map((l) => ({
    variant_id: l.variant_id,
    product_name: l.product_name,
    product_slug: l.product_slug,
    variant_name: l.variant_name,
    price: l.price,
    price_text: baht(l.price),
    compare_at_text: l.compare_at_price && l.compare_at_price > l.price ? baht(l.compare_at_price) : null,
    qty: l.qty,
    stock: l.stock,
    image: l.image_key ? `/media/${l.image_key}` : null,
    line_total_text: baht(l.line_total),
  })),
  errors: q.errors,
  coupon: q.coupon?.code ?? null,
  coupon_error: q.coupon_error,
  subtotal: baht(q.subtotal),
  discount: q.discount ? baht(q.discount) : null,
  shipping_fee: q.shipping_fee ? baht(q.shipping_fee) : 'ฟรี',
  cod_fee: q.cod_fee ? baht(q.cod_fee) : null,
  total: baht(q.total),
  weight_kg: (q.weight_g / 1000).toFixed(1),
  free_shipping_hint:
    q.free_shipping_min > 0 && q.subtotal - q.discount < q.free_shipping_min && q.shipping_fee > 0
      ? `ซื้อเพิ่มอีก ${baht(q.free_shipping_min - (q.subtotal - q.discount))} ส่งฟรี`
      : null,
});

app.post('/quote', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const s = await getSettings(c.env.DB);
  const q = await quote(c.env.DB, s, Array.isArray(body.items) ? body.items : [], body.coupon || null, body.payment_method);
  return c.json(publicQuote(q));
});

app.post('/orders', async (c) => {
  const body = await c.req.json<CheckoutInput>().catch(() => null);
  if (!body) return c.json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
  const s = await getSettings(c.env.DB);
  try {
    const r = await createOrder(c.env, s, body);
    const q = r.quote;
    const lines = q.lines.map((l) => `• ${l.product_name} (${l.variant_name}) ×${l.qty}`).join('\n');
    c.executionCtx.waitUntil(
      notifyLine(
        c.env,
        `🛒 ออเดอร์ใหม่ ${r.order_no}\n${body.customer_name} ${body.phone}\n${lines}\nรวม ${baht(q.total)} · ${
          r.method === 'cod' ? 'เก็บเงินปลายทาง' : 'พร้อมเพย์ (รอสลิป)'
        }\n${c.env.SHOP_URL}/admin/orders/${r.id}`,
      ),
    );
    return c.json({ ok: true, order_no: r.order_no, url: `/order/${r.order_no}?k=${r.access_key}&m=placed` });
  } catch (e) {
    if (e instanceof CheckoutError) return c.json({ error: e.message }, 400);
    console.error(e);
    return c.json({ error: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' }, 500);
  }
});

export default app;
