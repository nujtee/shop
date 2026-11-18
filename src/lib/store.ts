import { Env, nowIso, orderNo, randomToken } from './util';

export type Settings = Record<string, string>;

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export type ShippingTier = { max_g: number; fee: number };

export function parseTiers(s: Settings): ShippingTier[] {
  try {
    const t = JSON.parse(s.shipping_tiers || '[]') as ShippingTier[];
    return t.filter((x) => x.max_g > 0 && x.fee >= 0).sort((a, b) => a.max_g - b.max_g);
  } catch {
    return [];
  }
}

/** ค่าส่งตามน้ำหนักรวม (กรัม) เป็นสตางค์ */
export function shippingFee(weightG: number, s: Settings): number {
  const tiers = parseTiers(s);
  if (!tiers.length || weightG <= 0) return 0;
  const tier = tiers.find((t) => weightG <= t.max_g);
  if (tier) return tier.fee;
  const last = tiers[tiers.length - 1];
  const extraKg = Math.ceil((weightG - last.max_g) / 1000);
  return last.fee + extraKg * (parseInt(s.shipping_extra_per_kg || '0', 10) || 0);
}

export type Coupon = {
  id: number;
  code: string;
  type: 'percent' | 'fixed' | 'free_shipping';
  value: number;
  min_spend: number;
  max_discount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  used_count: number;
  active: number;
};

export type CartLine = {
  variant_id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  variant_name: string;
  price: number;
  compare_at_price: number | null;
  qty: number;
  stock: number;
  weight_g: number;
  image_key: string | null;
  line_total: number;
};

export type Quote = {
  lines: CartLine[];
  errors: string[];
  subtotal: number;
  discount: number;
  shipping_fee: number;
  cod_fee: number;
  total: number;
  weight_g: number;
  coupon: Coupon | null;
  coupon_error: string | null;
  free_shipping_min: number;
};

export async function quote(
  db: D1Database,
  s: Settings,
  items: { variant_id: number; qty: number }[],
  couponCode: string | null,
  payment: string,
): Promise<Quote> {
  const errors: string[] = [];
  const merged = new Map<number, number>();
  for (const it of items.slice(0, 50)) {
    const id = Number(it.variant_id);
    const q = Math.floor(Number(it.qty));
    if (id > 0 && q > 0) merged.set(id, Math.min(999, (merged.get(id) || 0) + q));
  }
  const ids = [...merged.keys()];
  let rows: any[] = [];
  if (ids.length) {
    const r = await db
      .prepare(
        `SELECT v.id AS variant_id, v.product_id, v.name AS variant_name, v.price, v.compare_at_price, v.stock, v.weight_g,
                p.name AS product_name, p.slug AS product_slug,
                (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_key
         FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.id IN (${ids.map(() => '?').join(',')}) AND v.active = 1 AND p.status = 'active'`,
      )
      .bind(...ids)
      .all();
    rows = r.results;
  }
  const lines: CartLine[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r.variant_id === id);
    if (!row) {
      errors.push('มีสินค้าบางรายการที่ไม่ได้วางขายแล้ว ระบบนำออกจากตะกร้าให้');
      continue;
    }
    const qty = merged.get(id)!;
    if (row.stock < qty) {
      errors.push(
        row.stock > 0
          ? `${row.product_name} (${row.variant_name}) เหลือ ${row.stock} ชิ้น`
          : `${row.product_name} (${row.variant_name}) สินค้าหมด`,
      );
    }
    lines.push({ ...row, qty, line_total: row.price * qty });
  }
  const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
  const weight_g = lines.reduce((a, l) => a + l.weight_g * l.qty, 0);

  let coupon: Coupon | null = null;
  let coupon_error: string | null = null;
  let discount = 0;
  let freeShipByCoupon = false;
  if (couponCode && couponCode.trim()) {
    const c = await db
      .prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE')
      .bind(couponCode.trim())
      .first<Coupon>();
    const now = nowIso();
    if (!c || !c.active) coupon_error = 'ไม่พบโค้ดนี้';
    else if (c.starts_at && now < c.starts_at) coupon_error = 'โค้ดนี้ยังไม่เริ่มใช้';
    else if (c.ends_at && now > c.ends_at) coupon_error = 'โค้ดนี้หมดอายุแล้ว';
    else if (c.usage_limit != null && c.used_count >= c.usage_limit) coupon_error = 'โค้ดนี้ถูกใช้ครบจำนวนแล้ว';
    else if (subtotal < c.min_spend) coupon_error = `ใช้ได้เมื่อซื้อครบ ฿${(c.min_spend / 100).toLocaleString('th-TH')}`;
    else {
      coupon = c;
      if (c.type === 'percent') discount = Math.floor((subtotal * c.value) / 100);
      else if (c.type === 'fixed') discount = c.value;
      else freeShipByCoupon = true;
      if (c.max_discount != null && discount > c.max_discount) discount = c.max_discount;
      discount = Math.min(discount, subtotal);
    }
  }

  const freeMin = parseInt(s.free_shipping_min || '0', 10) || 0;
  let shipping_fee = shippingFee(weight_g, s);
  if (freeShipByCoupon || (freeMin > 0 && subtotal - discount >= freeMin)) shipping_fee = 0;
  const cod_fee = payment === 'cod' && lines.length ? parseInt(s.cod_fee || '0', 10) || 0 : 0;
  const total = subtotal - discount + shipping_fee + cod_fee;
  return { lines, errors, subtotal, discount, shipping_fee, cod_fee, total, weight_g, coupon, coupon_error, free_shipping_min: freeMin };
}

export type CheckoutInput = {
  items: { variant_id: number; qty: number }[];
  coupon?: string;
  payment_method: 'promptpay' | 'cod';
  customer_name: string;
  phone: string;
  address_line: string;
  subdistrict?: string;
  district?: string;
  province: string;
  postcode: string;
  note?: string;
};

export class CheckoutError extends Error {}

/** สร้างออเดอร์: คำนวณราคาใหม่ฝั่งเซิร์ฟเวอร์ ตัดสต็อกแบบมีเงื่อนไข ถ้าไม่พอคืนสต็อกที่ตัดไปแล้ว */
export async function createOrder(env: Env, s: Settings, input: CheckoutInput) {
  const db = env.DB;
  const method = input.payment_method === 'cod' ? 'cod' : 'promptpay';
  if (method === 'cod' && s.cod_enabled !== '1') throw new CheckoutError('ร้านยังไม่เปิดเก็บเงินปลายทาง');
  if (method === 'promptpay' && !s.promptpay_id) throw new CheckoutError('ร้านยังไม่ได้ตั้งค่าบัญชีพร้อมเพย์');
  const req = (v: unknown, label: string, max = 200) => {
    const t = String(v ?? '').trim();
    if (!t) throw new CheckoutError(`กรุณากรอก${label}`);
    return t.slice(0, max);
  };
  const name = req(input.customer_name, 'ชื่อผู้รับ', 100);
  const phone = req(input.phone, 'เบอร์โทร', 20).replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 9) throw new CheckoutError('เบอร์โทรไม่ถูกต้อง');
  const address = req(input.address_line, 'ที่อยู่', 300);
  const province = req(input.province, 'จังหวัด', 60);
  const postcode = req(input.postcode, 'รหัสไปรษณีย์', 5);
  if (!/^\d{5}$/.test(postcode)) throw new CheckoutError('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');

  const q = await quote(db, s, input.items || [], input.coupon || null, method);
  if (!q.lines.length) throw new CheckoutError('ตะกร้าว่าง');
  if (q.errors.length) throw new CheckoutError(q.errors.join(' · '));
  if (input.coupon && q.coupon_error) throw new CheckoutError(q.coupon_error);

  // ตัดสต็อก
  const dec = await db.batch(
    q.lines.map((l) =>
      db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?').bind(l.qty, l.variant_id, l.qty),
    ),
  );
  const failed = dec.findIndex((r) => !r.meta.changes);
  if (failed >= 0) {
    const restore = q.lines
      .filter((_, i) => dec[i].meta.changes)
      .map((l) => db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?').bind(l.qty, l.variant_id));
    if (restore.length) await db.batch(restore);
    throw new CheckoutError(`${q.lines[failed].product_name} มีไม่พอ กรุณาลดจำนวนแล้วลองใหม่`);
  }

  const no = orderNo();
  const key = randomToken(12);
  const order = await db
    .prepare(
      `INSERT INTO orders (order_no, access_key, customer_name, phone, address_line, subdistrict, district, province, postcode, note,
        payment_method, payment_status, status, subtotal, discount, shipping_fee, cod_fee, total, total_weight_g, coupon_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    )
    .bind(
      no,
      key,
      name,
      phone,
      address,
      String(input.subdistrict ?? '').trim().slice(0, 80),
      String(input.district ?? '').trim().slice(0, 80),
      province,
      postcode,
      String(input.note ?? '').trim().slice(0, 500),
      method,
      method === 'cod' ? 'cod' : 'awaiting',
      method === 'cod' ? 'to_pack' : 'awaiting_payment',
      q.subtotal,
      q.discount,
      q.shipping_fee,
      q.cod_fee,
      q.total,
      q.weight_g,
      q.coupon?.code ?? null,
    )
    .first<{ id: number }>();
  const orderId = order!.id;
  const stmts: D1PreparedStatement[] = [];
  for (const l of q.lines) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, price, qty, image_key) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(orderId, l.product_id, l.variant_id, l.product_name, l.variant_name, l.price, l.qty, l.image_key),
      db
        .prepare('INSERT INTO stock_movements (variant_id, change, reason, order_id) VALUES (?,?,?,?)')
        .bind(l.variant_id, -l.qty, `ออเดอร์ ${no}`, orderId),
      db.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?').bind(l.qty, l.product_id),
    );
  }
  if (q.coupon) stmts.push(db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').bind(q.coupon.id));
  await db.batch(stmts);
  return { id: orderId, order_no: no, access_key: key, quote: q, method };
}

/** ยกเลิกออเดอร์และคืนสต็อก (ทำซ้ำได้อย่างปลอดภัย) */
export async function cancelOrder(db: D1Database, orderId: number, reason: string) {
  const res = await db
    .prepare(
      `UPDATE orders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status != 'cancelled' RETURNING order_no, coupon_code`,
    )
    .bind(nowIso(), nowIso(), orderId)
    .first<{ order_no: string; coupon_code: string | null }>();
  if (!res) return false;
  const { results: items } = await db
    .prepare('SELECT product_id, variant_id, qty FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ product_id: number; variant_id: number; qty: number }>();
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    if (!it.variant_id) continue;
    stmts.push(
      db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?').bind(it.qty, it.variant_id),
      db
        .prepare('INSERT INTO stock_movements (variant_id, change, reason, order_id) VALUES (?,?,?,?)')
        .bind(it.variant_id, it.qty, `ยกเลิก ${res.order_no}: ${reason}`, orderId),
      db.prepare('UPDATE products SET sold_count = MAX(0, sold_count - ?) WHERE id = ?').bind(it.qty, it.product_id),
    );
  }
  if (res.coupon_code)
    stmts.push(
      db.prepare('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ? COLLATE NOCASE').bind(res.coupon_code),
    );
  if (stmts.length) await db.batch(stmts);
  return true;
}
