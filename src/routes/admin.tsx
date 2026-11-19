import { Hono } from 'hono';
import type { Child } from 'hono/jsx';
import {
  Env,
  baht,
  toSatang,
  toInt,
  slugify,
  randomToken,
  nowIso,
  thaiTime,
  localToIso,
  isoToLocal,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
} from '../lib/util';
import { getSettings, cancelOrder, parseTiers, ShippingTier } from '../lib/store';
import { login, logout, requireAdmin } from '../lib/auth';
import { Shell, imgUrl } from '../views/layout';
import { PALETTE, PRESETS, isHex, themeVars, DEFAULT_ACCENT, DEFAULT_LEAF } from '../lib/theme';

const app = new Hono<{ Bindings: Env }>();

const NAV: [string, string][] = [
  ['/admin', 'ภาพรวม'],
  ['/admin/orders', 'คำสั่งซื้อ'],
  ['/admin/products', 'สินค้า'],
  ['/admin/stock', 'สต็อก'],
  ['/admin/categories', 'หมวดหมู่'],
  ['/admin/coupons', 'คูปอง'],
  ['/admin/settings', 'ตั้งค่าร้าน'],
  ['/admin/theme', 'ธีมสี'],
  ['/admin/seo', 'โลโก้และ SEO'],
];

const MSG: Record<string, string> = {
  saved: 'บันทึกแล้ว',
  deleted: 'ลบแล้ว',
  created: 'สร้างแล้ว',
  uploaded: 'อัปโหลดรูปแล้ว',
  cancelled: 'ยกเลิกออเดอร์และคืนสต็อกแล้ว',
  updated: 'อัปเดตสถานะแล้ว',
  inuse: 'ลบไม่ได้ เพราะยังมีสินค้าในหมวดนี้',
  dup: 'ชื่อหรือโค้ดนี้มีอยู่แล้ว',
  invalid: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง',
  badcolor: 'เลือกสีไม่ถูกต้อง',
  badimg: 'ใช้ได้เฉพาะไฟล์ PNG, JPG หรือ WebP ขนาดไม่เกิน 2 MB',
  removed: 'ลบรูปแล้ว',
  badpp: 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลข 13 หลัก',
};

function Admin(props: { title: string; path: string; msg?: string; children: Child; wide?: boolean }) {
  return (
    <Shell title={`${props.title} · หลังบ้าน`} noindex bodyClass="admin-body" scripts={['/admin.js?v=3']}>
      <div class="admin">
        <aside class="side">
          <a class="lg" href="/admin">
            Phasakura · หลังบ้าน
          </a>
          <nav>
            {NAV.map(([href, label]) => (
              <a
                href={href}
                class={(href === '/admin' ? props.path === href : props.path.startsWith(href)) ? 'on' : ''}
              >
                {label}
              </a>
            ))}
          </nav>
          <div class="side-foot">
            <a href="/" target="_blank">
              ดูหน้าร้าน ↗
            </a>
            <form method="post" action="/admin/logout">
              <button class="linkbtn">ออกจากระบบ</button>
            </form>
          </div>
        </aside>
        <main class="main">
          {props.msg && MSG[props.msg] && (
            <p class={['inuse', 'dup', 'invalid', 'badpp'].includes(props.msg) ? 'err' : 'ok'}>{MSG[props.msg]}</p>
          )}
          {props.children}
        </main>
      </div>
    </Shell>
  );
}

const Status = ({ s }: { s: string }) => <span class={`st st-${s}`}>{ORDER_STATUS[s] || s}</span>;

/** ค่าจากฟอร์มที่อาจมีหลายช่องชื่อเดียวกัน */
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

// ---------- เข้าสู่ระบบ ----------
app.get('/login', (c) => {
  const err = c.req.query('e');
  return c.html(
    <Shell title="เข้าสู่ระบบหลังบ้าน" noindex scripts={[]}>
      <form class="login" method="post">
        <h1>หลังบ้าน Phasakura</h1>
        <label>
          รหัสผ่าน
          <input type="password" name="password" required autofocus autocomplete="current-password" />
        </label>
        <input type="hidden" name="next" value={c.req.query('next') || '/admin'} />
        {err && <p class="err">รหัสผ่านไม่ถูกต้อง</p>}
        <button class="btn pri wide">เข้าสู่ระบบ</button>
      </form>
    </Shell>,
  );
});

app.post('/login', async (c) => {
  const f = await c.req.parseBody();
  const ok = await login(c, String(f.password || ''));
  const next = String(f.next || '/admin');
  if (!ok) return c.redirect('/admin/login?e=1');
  return c.redirect(next.startsWith('/admin') ? next : '/admin');
});

app.post('/logout', (c) => {
  logout(c);
  return c.redirect('/admin/login');
});

app.use('*', async (c, next) => {
  if (c.req.path === '/admin/login') return next();
  return requireAdmin(c, next);
});

// ---------- ภาพรวม ----------
app.get('/', async (c) => {
  const db = c.env.DB;
  const s = await getSettings(db);
  const todayStart = new Date(Date.now() + 7 * 3600_000);
  todayStart.setUTCHours(0, 0, 0, 0);
  const startIso = new Date(todayStart.getTime() - 7 * 3600_000).toISOString();
  const weekIso = new Date(todayStart.getTime() - 7 * 3600_000 - 6 * 86400_000).toISOString();
  const [today, counts, low, recent, week] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM orders WHERE created_at >= ? AND status != 'cancelled'`)
      .bind(startIso)
      .first<{ n: number; t: number }>(),
    db
      .prepare(
        `SELECT
          SUM(payment_status = 'slip_uploaded' AND status = 'awaiting_payment') slips,
          SUM(status IN ('to_pack','packing')) topack,
          SUM(status = 'awaiting_payment' AND payment_status = 'awaiting') unpaid
         FROM orders`,
      )
      .first<{ slips: number; topack: number; unpaid: number }>(),
    db
      .prepare(
        `SELECT v.id, v.name vname, v.stock, p.name, p.id pid FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.active = 1 AND p.status = 'active' AND v.stock <= ? ORDER BY v.stock LIMIT 10`,
      )
      .bind(toInt(s.low_stock, 5))
      .all<any>(),
    db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all<any>(),
    db
      .prepare(
        `SELECT substr(datetime(created_at, '+7 hours'), 1, 10) d, SUM(total) t FROM orders
         WHERE created_at >= ? AND status != 'cancelled' GROUP BY d`,
      )
      .bind(weekIso)
      .all<{ d: string; t: number }>(),
  ]);
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(todayStart.getTime() - (6 - i) * 86400_000).toISOString().slice(0, 10);
    return { d, t: week.results.find((r) => r.d === d)?.t || 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.t));
  const dayName = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('th-TH', { weekday: 'short', timeZone: 'UTC' });
  return c.html(
    <Admin title="ภาพรวม" path="/admin">
      <h1>ภาพรวมวันนี้</h1>
      {(!s.promptpay_id || !c.env.LINE_CHANNEL_ACCESS_TOKEN) && (
        <div class="warn">
          ยังตั้งค่าไม่ครบ:
          {!s.promptpay_id && (
            <>
              {' '}
              <a href="/admin/settings">ใส่เลขพร้อมเพย์</a> (ยังรับชำระพร้อมเพย์ไม่ได้)
            </>
          )}
          {!c.env.LINE_CHANNEL_ACCESS_TOKEN && ' · ยังไม่ได้เชื่อม LINE แจ้งเตือน'}
        </div>
      )}
      <div class="kpis">
        <div class="kpi">
          <small>ยอดขายวันนี้</small>
          <b>{baht(today?.t || 0)}</b>
          <em>{today?.n || 0} ออเดอร์</em>
        </div>
        <a class="kpi" href="/admin/orders?status=slip">
          <small>สลิปรอตรวจ</small>
          <b>{counts?.slips || 0}</b>
          <em>กดเพื่อตรวจ</em>
        </a>
        <a class="kpi" href="/admin/orders?status=to_pack">
          <small>รอแพ็ค</small>
          <b>{counts?.topack || 0}</b>
          <em>รวมกำลังแพ็ค</em>
        </a>
        <a class="kpi" href="/admin/stock?low=1">
          <small>สินค้าใกล้หมด</small>
          <b>{low.results.length}</b>
          <em>เหลือไม่เกิน {s.low_stock} ชิ้น</em>
        </a>
      </div>
      <div class="two">
        <section class="panel">
          <h2>ยอดขาย 7 วัน</h2>
          <div class="bars">
            {days.map((d) => (
              <div class="bar" title={`${d.d}: ${baht(d.t)}`}>
                <span style={`height:${Math.max(2, (d.t / max) * 100)}%`}></span>
              </div>
            ))}
          </div>
          <div class="blabels">
            {days.map((d) => (
              <span>{dayName(d.d)}</span>
            ))}
          </div>
          <div class="muted">สูงสุด {baht(max === 1 ? 0 : max)} ต่อวัน</div>
        </section>
        <section class="panel">
          <h2>สินค้าใกล้หมด</h2>
          {low.results.length ? (
            low.results.map((v: any) => (
              <div class="row">
                <a href={`/admin/products/${v.pid}`}>
                  {v.name} · {v.vname}
                </a>
                <b class={v.stock <= 0 ? 'neg' : ''}>{v.stock}</b>
              </div>
            ))
          ) : (
            <p class="muted">ไม่มีสินค้าใกล้หมด</p>
          )}
        </section>
      </div>
      <h2>ออเดอร์ล่าสุด</h2>
      <OrdersTable rows={recent.results} />
    </Admin>,
  );
});

function OrdersTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <p class="muted">ยังไม่มีออเดอร์</p>;
  return (
    <div class="tbl">
      <table>
        <thead>
          <tr>
            <th>ออเดอร์</th>
            <th>เวลา</th>
            <th>ลูกค้า</th>
            <th class="num">ยอด</th>
            <th>ชำระ</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr>
              <td>
                <a href={`/admin/orders/${o.id}`}>{o.order_no}</a>
              </td>
              <td>{thaiTime(o.created_at)}</td>
              <td>
                {o.customer_name}
                <br />
                <small class="muted">{o.province}</small>
              </td>
              <td class="num">{baht(o.total)}</td>
              <td>
                {PAYMENT_METHOD[o.payment_method]}
                <br />
                <small class={o.payment_status === 'slip_uploaded' ? 'hl' : 'muted'}>{PAYMENT_STATUS[o.payment_status]}</small>
              </td>
              <td>
                <Status s={o.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- คำสั่งซื้อ ----------
const ORDER_FILTERS: [string, string][] = [
  ['', 'ทั้งหมด'],
  ['slip', 'สลิปรอตรวจ'],
  ['awaiting_payment', 'รอชำระ'],
  ['to_pack', 'รอแพ็ค'],
  ['packing', 'กำลังแพ็ค'],
  ['shipped', 'ส่งแล้ว'],
  ['delivered', 'ได้รับแล้ว'],
  ['cancelled', 'ยกเลิก'],
];

app.get('/orders', async (c) => {
  const status = c.req.query('status') || '';
  const q = (c.req.query('q') || '').trim();
  const where: string[] = [];
  const b: unknown[] = [];
  if (status === 'slip') where.push(`payment_status = 'slip_uploaded' AND status = 'awaiting_payment'`);
  else if (status) {
    where.push('status = ?');
    b.push(status);
  }
  if (q) {
    where.push('(order_no LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR tracking_no LIKE ?)');
    b.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`,
  )
    .bind(...b)
    .all<any>();
  const toPackIds = results.filter((o) => ['to_pack', 'packing'].includes(o.status)).map((o) => o.id);
  return c.html(
    <Admin title="คำสั่งซื้อ" path="/admin/orders" msg={c.req.query('m')}>
      <h1>คำสั่งซื้อ</h1>
      <form class="toolbar" method="get">
        <input name="q" value={q} placeholder="ค้นหาเลขออเดอร์ ชื่อ เบอร์ เลขพัสดุ" />
        <input type="hidden" name="status" value={status} />
        <button class="btn ghost">ค้นหา</button>
        {toPackIds.length > 0 && (
          <a class="btn ghost" href={`/admin/labels?ids=${toPackIds.join(',')}`} target="_blank">
            พิมพ์ใบปะหน้า ({toPackIds.length})
          </a>
        )}
      </form>
      <div class="chips">
        {ORDER_FILTERS.map(([k, label]) => (
          <a class={`chip ${status === k ? 'on' : ''}`} href={`/admin/orders?status=${k}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
            {label}
          </a>
        ))}
      </div>
      <OrdersTable rows={results} />
    </Admin>,
  );
});

app.get('/orders/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<any>();
  if (!o) return c.notFound();
  const { results: items } = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id).all<any>();
  const act = (action: string, label: string, cls = 'ghost', confirm?: string) => (
    <form method="post" action={`/admin/orders/${id}/action`} data-confirm={confirm}>
      <input type="hidden" name="action" value={action} />
      <button class={`btn ${cls}`}>{label}</button>
    </form>
  );
  return c.html(
    <Admin title={o.order_no} path="/admin/orders" msg={c.req.query('m')}>
      <div class="head-row">
        <h1>{o.order_no}</h1>
        <Status s={o.status} />
      </div>
      <p class="muted">
        สั่งเมื่อ {thaiTime(o.created_at)} · {PAYMENT_METHOD[o.payment_method]} · {PAYMENT_STATUS[o.payment_status]}
        {o.paid_at && ` (${thaiTime(o.paid_at)})`}
      </p>
      <div class="two">
        <section class="panel">
          <h2>สินค้า</h2>
          {items.map((it: any) => (
            <div class="ci">
              <div class="th">{it.image_key ? <img src={imgUrl(it.image_key)} alt="" /> : '🌱'}</div>
              <div>
                <div>{it.product_name}</div>
                <div class="muted">
                  {it.variant_name} · {baht(it.price)} × {it.qty}
                </div>
              </div>
              <div class="num">{baht(it.price * it.qty)}</div>
            </div>
          ))}
          <div class="sum">
            <div>
              <span>ค่าสินค้า</span>
              <span>{baht(o.subtotal)}</span>
            </div>
            {o.discount > 0 && (
              <div>
                <span>ส่วนลด {o.coupon_code}</span>
                <span>−{baht(o.discount)}</span>
              </div>
            )}
            <div>
              <span>ค่าส่ง ({(o.total_weight_g / 1000).toFixed(2)} กก.)</span>
              <span>{baht(o.shipping_fee)}</span>
            </div>
            {o.cod_fee > 0 && (
              <div>
                <span>ค่าบริการปลายทาง</span>
                <span>{baht(o.cod_fee)}</span>
              </div>
            )}
            <div class="tot">
              <span>รวม</span>
              <span>{baht(o.total)}</span>
            </div>
          </div>
        </section>
        <section class="panel">
          <h2>จัดส่งถึง</h2>
          <p>
            <b>{o.customer_name}</b> · <a href={`tel:${o.phone}`}>{o.phone}</a>
            <br />
            {o.address_line} {o.subdistrict} {o.district} {o.province} {o.postcode}
          </p>
          {o.note && <p class="box">หมายเหตุลูกค้า: {o.note}</p>}
          <a class="btn ghost" href={`/admin/labels?ids=${o.id}`} target="_blank">
            พิมพ์ใบปะหน้า
          </a>
          {o.slip_key && (
            <>
              <h2>สลิป</h2>
              <a href={`/admin/slip/${o.slip_key}`} target="_blank">
                <img class="slip-img" src={`/admin/slip/${o.slip_key}`} alt="สลิปโอนเงิน" />
              </a>
            </>
          )}
        </section>
      </div>
      <section class="panel">
        <h2>จัดการ</h2>
        <div class="actions">
          {o.status === 'awaiting_payment' && act('mark_paid', `ยืนยันรับเงิน ${baht(o.total)}`, 'pri')}
          {o.status === 'awaiting_payment' && o.payment_status === 'slip_uploaded' &&
            act('reject_slip', 'สลิปไม่ถูกต้อง ให้ลูกค้าแนบใหม่')}
          {o.status === 'to_pack' && act('packing', 'เริ่มแพ็ค', 'pri')}
          {o.status === 'delivered' || o.status === 'cancelled' ? null : null}
          {o.status === 'shipped' && act('delivered', 'ลูกค้าได้รับแล้ว')}
        </div>
        {['to_pack', 'packing', 'shipped'].includes(o.status) && (
          <form class="fields" method="post" action={`/admin/orders/${id}/action`}>
            <input type="hidden" name="action" value="ship" />
            <label>
              ขนส่ง
              <input name="carrier" value={o.carrier || 'Flash Express'} list="carriers" />
              <datalist id="carriers">
                <option value="Flash Express" />
                <option value="Kerry Express" />
                <option value="J&T Express" />
                <option value="ไปรษณีย์ไทย" />
                <option value="Best Express" />
              </datalist>
            </label>
            <label>
              เลขพัสดุ
              <input name="tracking_no" value={o.tracking_no} required />
            </label>
            <button class="btn pri full">{o.status === 'shipped' ? 'แก้เลขพัสดุ' : 'บันทึกเลขพัสดุและเปลี่ยนเป็นส่งแล้ว'}</button>
          </form>
        )}
        <form class="fields" method="post" action={`/admin/orders/${id}/action`}>
          <input type="hidden" name="action" value="note" />
          <label class="full">
            โน้ตภายในร้าน
            <textarea name="admin_note" rows={2}>
              {o.admin_note}
            </textarea>
          </label>
          <button class="btn ghost">บันทึกโน้ต</button>
        </form>
        {o.status !== 'cancelled' && o.status !== 'delivered' && (
          <div class="actions danger">
            {act('cancel', 'ยกเลิกออเดอร์และคืนสต็อก', 'danger', 'ยกเลิกออเดอร์นี้และคืนสต็อก?')}
          </div>
        )}
        <p class="muted">
          ลิงก์ติดตามของลูกค้า:{' '}
          <span class="mono">
            {c.env.SHOP_URL}/order/{o.order_no}?k={o.access_key}
          </span>
        </p>
      </section>
    </Admin>,
  );
});

app.post('/orders/:id/action', async (c) => {
  const id = toInt(c.req.param('id'));
  const f = await c.req.parseBody();
  const db = c.env.DB;
  const now = nowIso();
  const back = (m = 'updated') => c.redirect(`/admin/orders/${id}?m=${m}`);
  switch (f.action) {
    case 'mark_paid':
      await db
        .prepare(
          `UPDATE orders SET payment_status = 'paid', status = 'to_pack', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'`,
        )
        .bind(now, now, id)
        .run();
      return back();
    case 'reject_slip':
      await db
        .prepare(
          `UPDATE orders SET payment_status = 'awaiting', slip_key = NULL, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'`,
        )
        .bind(now, id)
        .run();
      return back();
    case 'packing':
      await db.prepare(`UPDATE orders SET status = 'packing', updated_at = ? WHERE id = ? AND status = 'to_pack'`).bind(now, id).run();
      return back();
    case 'ship': {
      const tracking = String(f.tracking_no || '').trim().slice(0, 60);
      if (!tracking) return back('invalid');
      await db
        .prepare(
          `UPDATE orders SET status = 'shipped', carrier = ?, tracking_no = ?, shipped_at = COALESCE(shipped_at, ?), updated_at = ?
           WHERE id = ? AND status IN ('to_pack','packing','shipped')`,
        )
        .bind(String(f.carrier || '').trim().slice(0, 40), tracking, now, now, id)
        .run();
      return back();
    }
    case 'delivered':
      await db.prepare(`UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ? AND status = 'shipped'`).bind(now, id).run();
      return back();
    case 'note':
      await db
        .prepare('UPDATE orders SET admin_note = ?, updated_at = ? WHERE id = ?')
        .bind(String(f.admin_note || '').slice(0, 1000), now, id)
        .run();
      return back('saved');
    case 'cancel':
      await cancelOrder(db, id, 'ร้านยกเลิก');
      return back('cancelled');
  }
  return back('invalid');
});

app.get('/slip/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice('/admin/slip/'.length));
  if (!key.startsWith('slips/')) return c.notFound();
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('cache-control', 'private, max-age=3600');
  return new Response(obj.body, { headers: h });
});

app.get('/labels', async (c) => {
  const s = await getSettings(c.env.DB);
  const ids = (c.req.query('ids') || '')
    .split(',')
    .map((x) => toInt(x))
    .filter((x) => x > 0)
    .slice(0, 100);
  if (!ids.length) return c.notFound();
  const { results: orders } = await c.env.DB.prepare(`SELECT * FROM orders WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<any>();
  const { results: items } = await c.env.DB.prepare(
    `SELECT order_id, product_name, variant_name, qty FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<any>();
  return c.html(
    <Shell title="ใบปะหน้า" scripts={[]} bodyClass="labels-body">
      <p class="noprint">
        กด Ctrl+P (หรือแชร์ → พิมพ์ บนมือถือ) เพื่อพิมพ์ ใบละ 1 ออเดอร์ ขนาด A6
      </p>
      {orders.map((o: any) => (
        <section class="label">
          <div class="lab-from">
            <b>ผู้ส่ง</b> {s.shop_name} {s.ship_from}
          </div>
          <div class="lab-to">
            <b>ผู้รับ</b>
            <div class="lab-name">
              {o.customer_name} · {o.phone}
            </div>
            <div>
              {o.address_line} {o.subdistrict} {o.district}
            </div>
            <div class="lab-prov">
              {o.province} {o.postcode}
            </div>
          </div>
          <div class="lab-meta">
            <span>{o.order_no}</span>
            <span>{o.payment_method === 'cod' ? `เก็บเงินปลายทาง ${baht(o.total)}` : 'ชำระแล้ว'}</span>
          </div>
          <ul class="lab-items">
            {items
              .filter((i: any) => i.order_id === o.id)
              .map((i: any) => (
                <li>
                  {i.product_name} ({i.variant_name}) ×{i.qty}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </Shell>,
  );
});

// ---------- สินค้า ----------
app.get('/products', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.status, p.sold_count, c.name cat,
       MIN(v.price) price, SUM(CASE WHEN v.active THEN v.stock ELSE 0 END) stock, COUNT(v.id) nv,
       (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1) image_key
     FROM products p LEFT JOIN variants v ON v.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id
     ${q ? 'WHERE p.name LIKE ?' : ''}
     GROUP BY p.id ORDER BY p.id DESC LIMIT 500`,
  )
    .bind(...(q ? [`%${q}%`] : []))
    .all<any>();
  return c.html(
    <Admin title="สินค้า" path="/admin/products" msg={c.req.query('m')}>
      <div class="head-row">
        <h1>สินค้า ({results.length})</h1>
        <a class="btn pri" href="/admin/products/new">
          + เพิ่มสินค้า
        </a>
      </div>
      <form class="toolbar" method="get">
        <input name="q" value={q} placeholder="ค้นหาชื่อสินค้า" />
        <button class="btn ghost">ค้นหา</button>
      </form>
      {results.length ? (
        <div class="tbl">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>สินค้า</th>
                <th>หมวด</th>
                <th class="num">ราคาเริ่มต้น</th>
                <th class="num">คงเหลือ</th>
                <th class="num">ขายแล้ว</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p: any) => (
                <tr>
                  <td>
                    <div class="th sm">{p.image_key ? <img src={imgUrl(p.image_key)} alt="" /> : '🌱'}</div>
                  </td>
                  <td>
                    <a href={`/admin/products/${p.id}`}>{p.name}</a>
                    {p.nv > 1 && <small class="muted"> · {p.nv} ตัวเลือก</small>}
                  </td>
                  <td>{p.cat || '—'}</td>
                  <td class="num">{p.price != null ? baht(p.price) : '—'}</td>
                  <td class="num">{p.stock ?? 0}</td>
                  <td class="num">{p.sold_count}</td>
                  <td>{p.status === 'active' ? <span class="st st-shipped">เปิดขาย</span> : <span class="st st-cancelled">ซ่อน</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="empty">
          ยังไม่มีสินค้า <a href="/admin/products/new">เพิ่มสินค้าชิ้นแรก</a>
        </p>
      )}
    </Admin>,
  );
});

async function productForm(c: any, id: number | null) {
  const db: D1Database = c.env.DB;
  const { results: cats } = await db.prepare('SELECT id, name FROM categories ORDER BY sort_order, id').all<any>();
  let p: any = { name: '', slug: '', description: '', status: 'active', badge: '', is_featured: 0, category_id: cats[0]?.id };
  let variants: any[] = [{ id: '', name: 'มาตรฐาน', price: '', compare_at_price: '', stock: 0, weight_g: 500, sku: '', active: 1 }];
  let images: any[] = [];
  if (id) {
    p = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<any>();
    if (!p) return c.notFound();
    variants = (await db.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY sort_order, id').bind(id).all<any>()).results;
    images = (await db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id').bind(id).all<any>()).results;
  }
  const money = (v: any) => (v === '' || v == null ? '' : (v / 100).toFixed(2).replace(/\.00$/, ''));
  return c.html(
    <Admin title={id ? p.name : 'เพิ่มสินค้า'} path="/admin/products" msg={c.req.query('m')}>
      <div class="head-row">
        <h1>{id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</h1>
        {id && p.status === 'active' && (
          <a class="btn ghost" href={`/p/${encodeURIComponent(p.slug)}`} target="_blank">
            ดูหน้าร้าน ↗
          </a>
        )}
      </div>
      <form class="fields" method="post" action={id ? `/admin/products/${id}` : '/admin/products'}>
        <label class="full">
          ชื่อสินค้า
          <input name="name" value={p.name} required maxlength={150} />
        </label>
        <label>
          หมวดหมู่
          <select name="category_id">
            <option value="">— ไม่ระบุ —</option>
            {cats.map((x: any) => (
              <option value={x.id} selected={x.id === p.category_id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          สถานะ
          <select name="status">
            <option value="active" selected={p.status === 'active'}>
              เปิดขาย
            </option>
            <option value="hidden" selected={p.status === 'hidden'}>
              ซ่อน
            </option>
          </select>
        </label>
        <label>
          ป้ายบนการ์ด (เช่น แนะนำ, ขายดี)
          <input name="badge" value={p.badge} maxlength={12} />
        </label>
        <label>
          ลิงก์สินค้า (เว้นว่างให้ระบบตั้งจากชื่อ)
          <input name="slug" value={p.slug} maxlength={80} />
        </label>
        <label class="check full">
          <input type="checkbox" name="is_featured" value="1" checked={!!p.is_featured} /> แสดงเป็นสินค้าแนะนำ (ขึ้นก่อนในหน้าร้าน)
        </label>
        <label class="full">
          รายละเอียด
          <textarea name="description" rows={6} maxlength={5000}>
            {p.description}
          </textarea>
        </label>
        <div class="full">
          <h2>ตัวเลือกสินค้า ราคา และสต็อก</h2>
          <p class="muted">
            เช่น ขนาดต้น หรือจำนวนต่อชุด แต่ละตัวเลือกมีราคา สต็อก และน้ำหนักของตัวเอง น้ำหนักใช้คิดค่าส่ง ตัวเลือกที่เคยขายแล้วลบไม่ได้
            ให้ตั้งเป็น “ปิด” แทน
          </p>
          <div class="tbl">
            <table class="variants" data-variants>
              <thead>
                <tr>
                  <th>ชื่อตัวเลือก</th>
                  <th>ราคา (฿)</th>
                  <th>ราคาก่อนลด (฿)</th>
                  <th>สต็อก</th>
                  <th>น้ำหนัก (กรัม)</th>
                  <th>SKU</th>
                  <th>ขาย</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr>
                    <td>
                      <input type="hidden" name="v_id" value={v.id} />
                      <input name="v_name" value={v.name} maxlength={60} />
                    </td>
                    <td>
                      <input name="v_price" value={money(v.price)} inputmode="decimal" size={7} />
                    </td>
                    <td>
                      <input name="v_compare" value={money(v.compare_at_price)} inputmode="decimal" size={7} />
                    </td>
                    <td>
                      <input name="v_stock" value={v.stock} inputmode="numeric" size={5} />
                    </td>
                    <td>
                      <input name="v_weight" value={v.weight_g} inputmode="numeric" size={6} />
                    </td>
                    <td>
                      <input name="v_sku" value={v.sku} size={8} maxlength={40} />
                    </td>
                    <td>
                      <select name="v_active">
                        <option value="1" selected={!!v.active}>
                          เปิด
                        </option>
                        <option value="0" selected={!v.active}>
                          ปิด
                        </option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" class="btn ghost" data-add-variant>
            + เพิ่มตัวเลือก
          </button>
        </div>
        <div class="full actions">
          <button class="btn pri">{id ? 'บันทึก' : 'สร้างสินค้า แล้วไปเพิ่มรูป'}</button>
        </div>
      </form>
      {id && (
        <section class="panel">
          <h2>รูปสินค้า</h2>
          <p class="muted">รูปแรกใช้เป็นรูปหน้าปก ระบบย่อรูปให้อัตโนมัติก่อนอัปโหลด</p>
          <div class="imgs">
            {images.map((im: any, i: number) => (
              <figure>
                <img src={imgUrl(im.r2_key)} alt="" />
                <figcaption>
                  {i > 0 && (
                    <form method="post" action={`/admin/products/${id}/images/${im.id}/first`}>
                      <button class="linkbtn">ตั้งเป็นปก</button>
                    </form>
                  )}
                  <form method="post" action={`/admin/products/${id}/images/${im.id}/delete`} data-confirm="ลบรูปนี้?">
                    <button class="linkbtn neg">ลบ</button>
                  </form>
                </figcaption>
              </figure>
            ))}
          </div>
          <form
            class="drop"
            method="post"
            action={`/admin/products/${id}/images`}
            enctype="multipart/form-data"
            data-image-upload
          >
            <input type="file" name="images" accept="image/*" multiple required aria-label="เลือกรูป" />
            <button class="btn ghost">อัปโหลด</button>
            <span data-upload-status class="muted"></span>
          </form>
        </section>
      )}
      {id && (
        <form method="post" action={`/admin/products/${id}/delete`} data-confirm="ลบสินค้านี้? ถ้าเคยขายแล้วระบบจะซ่อนแทน">
          <button class="btn danger">ลบสินค้า</button>
        </form>
      )}
    </Admin>,
  );
}

app.get('/products/new', (c) => productForm(c, null));
app.get('/products/:id', (c) => productForm(c, toInt(c.req.param('id'))));

async function saveProduct(c: any, id: number | null) {
  const db: D1Database = c.env.DB;
  const f = await c.req.parseBody({ all: true });
  const name = String(f.name || '').trim();
  if (!name) return c.redirect(id ? `/admin/products/${id}?m=invalid` : '/admin/products/new?m=invalid');
  let slug = slugify(String(f.slug || '').trim() || name);
  const clash = await db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').bind(slug, id ?? 0).first();
  if (clash) slug = `${slug}-${randomToken(2)}`;
  const vals = [
    toInt(f.category_id) || null,
    name.slice(0, 150),
    slug,
    String(f.description || '').slice(0, 5000),
    f.status === 'hidden' ? 'hidden' : 'active',
    String(f.badge || '').trim().slice(0, 12),
    f.is_featured ? 1 : 0,
  ];
  if (id) {
    await db
      .prepare(
        `UPDATE products SET category_id=?, name=?, slug=?, description=?, status=?, badge=?, is_featured=?, updated_at=? WHERE id=?`,
      )
      .bind(...vals, nowIso(), id)
      .run();
  } else {
    const r = await db
      .prepare(`INSERT INTO products (category_id, name, slug, description, status, badge, is_featured) VALUES (?,?,?,?,?,?,?) RETURNING id`)
      .bind(...vals)
      .first<{ id: number }>();
    id = r!.id;
  }

  // ตัวเลือก
  const ids = arr(f.v_id), names = arr(f.v_name), prices = arr(f.v_price), compares = arr(f.v_compare);
  const stocks = arr(f.v_stock), weights = arr(f.v_weight), skus = arr(f.v_sku), actives = arr(f.v_active);
  const { results: existing } = await db.prepare('SELECT id, stock FROM variants WHERE product_id = ?').bind(id).all<any>();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < names.length; i++) {
    const vid = toInt(ids[i]);
    const vname = (names[i] || '').trim().slice(0, 60);
    const price = toSatang(prices[i]);
    if (!vname && price == null && !vid) continue;
    if (!vname || price == null) continue;
    let compare = toSatang(compares[i]);
    if (compare != null && compare <= price) compare = null;
    const stock = Math.max(0, toInt(stocks[i]));
    const weight = Math.max(0, toInt(weights[i], 500));
    const active = actives[i] === '0' ? 0 : 1;
    const sku = (skus[i] || '').trim().slice(0, 40);
    const old = existing.find((e: any) => e.id === vid);
    if (old) {
      stmts.push(
        db
          .prepare(
            'UPDATE variants SET name=?, price=?, compare_at_price=?, stock=?, weight_g=?, sku=?, active=?, sort_order=? WHERE id=? AND product_id=?',
          )
          .bind(vname, price, compare, stock, weight, sku, active, i, vid, id),
      );
      if (stock !== old.stock)
        stmts.push(
          db
            .prepare('INSERT INTO stock_movements (variant_id, change, reason) VALUES (?,?,?)')
            .bind(vid, stock - old.stock, 'แก้ไขจากหน้าสินค้า'),
        );
    } else {
      stmts.push(
        db
          .prepare(
            'INSERT INTO variants (product_id, name, price, compare_at_price, stock, weight_g, sku, active, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .bind(id, vname, price, compare, stock, weight, sku, active, i),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  return c.redirect(`/admin/products/${id}?m=${c.req.path.endsWith('/products') ? 'created' : 'saved'}`);
}

app.post('/products', (c) => saveProduct(c, null));
app.post('/products/:id', (c) => saveProduct(c, toInt(c.req.param('id'))));

app.post('/products/:id/delete', async (c) => {
  const id = toInt(c.req.param('id'));
  const sold = await c.env.DB.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').bind(id).first();
  if (sold) {
    await c.env.DB.prepare(`UPDATE products SET status = 'hidden' WHERE id = ?`).bind(id).run();
    return c.redirect('/admin/products?m=saved');
  }
  const { results: imgs } = await c.env.DB.prepare('SELECT r2_key FROM product_images WHERE product_id = ?').bind(id).all<any>();
  if (imgs.length) await c.env.BUCKET.delete(imgs.map((i: any) => i.r2_key));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM variants WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id),
  ]);
  return c.redirect('/admin/products?m=deleted');
});

app.post('/products/:id/images', async (c) => {
  const id = toInt(c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!p) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const files = (Array.isArray(f.images) ? f.images : [f.images]).filter(
    (x): x is File => x instanceof File && x.size > 0 && x.type.startsWith('image/') && x.size <= 10 * 1024 * 1024,
  );
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM product_images WHERE product_id = ?')
    .bind(id)
    .first<{ m: number }>();
  let order = (max?.m ?? -1) + 1;
  for (const file of files.slice(0, 12)) {
    const ext = (file.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '').slice(0, 5);
    const key = `products/${id}/${randomToken(8)}.${ext}`;
    await c.env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    await c.env.DB.prepare('INSERT INTO product_images (product_id, r2_key, sort_order) VALUES (?,?,?)').bind(id, key, order++).run();
  }
  if (c.req.header('accept')?.includes('application/json')) return c.json({ ok: true, count: files.length });
  return c.redirect(`/admin/products/${id}?m=uploaded`);
});

app.post('/products/:id/images/:img/delete', async (c) => {
  const id = toInt(c.req.param('id'));
  const img = await c.env.DB.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?')
    .bind(toInt(c.req.param('img')), id)
    .first<any>();
  if (img) {
    await c.env.BUCKET.delete(img.r2_key);
    await c.env.DB.prepare('DELETE FROM product_images WHERE id = ?').bind(img.id).run();
  }
  return c.redirect(`/admin/products/${id}?m=deleted`);
});

app.post('/products/:id/images/:img/first', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('UPDATE product_images SET sort_order = -1 - (SELECT COUNT(*) FROM product_images WHERE product_id = ?) WHERE id = ? AND product_id = ?')
    .bind(id, toInt(c.req.param('img')), id)
    .run();
  return c.redirect(`/admin/products/${id}?m=saved`);
});

// ---------- สต็อก ----------
app.get('/stock', async (c) => {
  const s = await getSettings(c.env.DB);
  const low = c.req.query('low') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.name vname, v.stock, v.sku, p.name, p.id pid,
       (SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE oi.variant_id = v.id AND o.status = 'awaiting_payment') reserved
     FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.active = 1 ${low ? 'AND v.stock <= ?' : ''}
     ORDER BY v.stock ASC, p.name LIMIT 1000`,
  )
    .bind(...(low ? [toInt(s.low_stock, 5)] : []))
    .all<any>();
  const { results: moves } = await c.env.DB.prepare(
    `SELECT m.*, v.name vname, p.name pname FROM stock_movements m
     LEFT JOIN variants v ON v.id = m.variant_id LEFT JOIN products p ON p.id = v.product_id
     ORDER BY m.id DESC LIMIT 30`,
  ).all<any>();
  return c.html(
    <Admin title="สต็อก" path="/admin/stock" msg={c.req.query('m')}>
      <h1>สต็อก</h1>
      <div class="chips">
        <a class={`chip ${!low ? 'on' : ''}`} href="/admin/stock">
          ทั้งหมด
        </a>
        <a class={`chip ${low ? 'on' : ''}`} href="/admin/stock?low=1">
          ใกล้หมด (≤ {s.low_stock})
        </a>
      </div>
      <p class="muted">
        ระบบตัดสต็อกทันทีที่ลูกค้าสั่งซื้อ “รอโอน” คือจำนวนที่ถูกจองในออเดอร์ที่ยังไม่จ่าย ถ้าไม่แนบสลิปภายใน {s.unpaid_cancel_hours}{' '}
        ชั่วโมงระบบยกเลิกและคืนสต็อกให้อัตโนมัติ
      </p>
      <div class="tbl">
        <table>
          <thead>
            <tr>
              <th>สินค้า</th>
              <th>ตัวเลือก</th>
              <th class="num">คงเหลือ</th>
              <th class="num">รอโอน</th>
              <th>ปรับสต็อก (+ รับเข้า / − ตัดออก)</th>
            </tr>
          </thead>
          <tbody>
            {results.map((v: any) => (
              <tr>
                <td>
                  <a href={`/admin/products/${v.pid}`}>{v.name}</a>
                </td>
                <td>
                  {v.vname}
                  {v.sku && <small class="muted"> · {v.sku}</small>}
                </td>
                <td class={`num ${v.stock <= toInt(s.low_stock, 5) ? 'neg' : ''}`}>{v.stock}</td>
                <td class="num">{v.reserved}</td>
                <td>
                  <form class="inline" method="post" action={`/admin/stock/${v.id}`}>
                    <input name="change" inputmode="numeric" size={4} placeholder="+10" required aria-label="จำนวนที่ปรับ" />
                    <input name="reason" size={12} placeholder="เหตุผล" aria-label="เหตุผล" />
                    <button class="btn ghost sm">บันทึก</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>ประวัติล่าสุด</h2>
      <div class="tbl">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>สินค้า</th>
              <th class="num">เปลี่ยน</th>
              <th>เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m: any) => (
              <tr>
                <td>{thaiTime(m.created_at)}</td>
                <td>
                  {m.pname} · {m.vname}
                </td>
                <td class={`num ${m.change < 0 ? 'neg' : 'pos'}`}>{m.change > 0 ? `+${m.change}` : m.change}</td>
                <td>{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Admin>,
  );
});

app.post('/stock/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const f = await c.req.parseBody();
  const change = toInt(String(f.change || '').replace('+', ''));
  if (!change) return c.redirect('/admin/stock?m=invalid');
  const r = await c.env.DB.prepare('UPDATE variants SET stock = MAX(0, stock + ?) WHERE id = ? RETURNING stock').bind(change, id).first();
  if (r)
    await c.env.DB.prepare('INSERT INTO stock_movements (variant_id, change, reason) VALUES (?,?,?)')
      .bind(id, change, String(f.reason || 'ปรับสต็อก').slice(0, 100) || 'ปรับสต็อก')
      .run();
  return c.redirect('/admin/stock?m=saved');
});

// ---------- หมวดหมู่ ----------
app.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) n FROM categories c ORDER BY sort_order, id`,
  ).all<any>();
  return c.html(
    <Admin title="หมวดหมู่" path="/admin/categories" msg={c.req.query('m')}>
      <h1>หมวดหมู่</h1>
      <p class="muted">หมวดหมู่แสดงเป็นแท็บบนหน้าร้าน เรียงตามลำดับเลขน้อยไปมาก</p>
      <div class="tbl">
        <table>
          <thead>
            <tr>
              <th>ลำดับ</th>
              <th>ชื่อ</th>
              <th class="num">สินค้า</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((x: any) => (
              <tr>
                <td colspan={2}>
                  <form class="inline" method="post" action={`/admin/categories/${x.id}`}>
                    <input name="sort_order" value={x.sort_order} size={2} inputmode="numeric" aria-label="ลำดับ" />
                    <input name="name" value={x.name} required aria-label="ชื่อหมวด" />
                    <button class="btn ghost sm">บันทึก</button>
                  </form>
                </td>
                <td class="num">{x.n}</td>
                <td>
                  <form method="post" action={`/admin/categories/${x.id}/delete`} data-confirm="ลบหมวดนี้?">
                    <button class="linkbtn neg">ลบ</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form class="inline" method="post" action="/admin/categories">
        <input name="name" placeholder="ชื่อหมวดใหม่" required />
        <button class="btn pri">+ เพิ่มหมวด</button>
      </form>
    </Admin>,
  );
});

app.post('/categories', async (c) => {
  const f = await c.req.parseBody();
  const name = String(f.name || '').trim().slice(0, 40);
  if (!name) return c.redirect('/admin/categories?m=invalid');
  const slug = slugify(name);
  try {
    await c.env.DB.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories))')
      .bind(name, slug)
      .run();
  } catch {
    return c.redirect('/admin/categories?m=dup');
  }
  return c.redirect('/admin/categories?m=created');
});

app.post('/categories/:id', async (c) => {
  const f = await c.req.parseBody();
  const name = String(f.name || '').trim().slice(0, 40);
  if (!name) return c.redirect('/admin/categories?m=invalid');
  await c.env.DB.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?')
    .bind(name, toInt(f.sort_order), toInt(c.req.param('id')))
    .run();
  return c.redirect('/admin/categories?m=saved');
});

app.post('/categories/:id/delete', async (c) => {
  const id = toInt(c.req.param('id'));
  const used = await c.env.DB.prepare('SELECT 1 FROM products WHERE category_id = ? LIMIT 1').bind(id).first();
  if (used) return c.redirect('/admin/categories?m=inuse');
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.redirect('/admin/categories?m=deleted');
});

// ---------- คูปอง ----------
app.get('/coupons', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM coupons ORDER BY id DESC').all<any>();
  const desc = (x: any) =>
    x.type === 'percent'
      ? `ลด ${x.value}%${x.max_discount ? ` สูงสุด ${baht(x.max_discount)}` : ''}`
      : x.type === 'fixed'
        ? `ลด ${baht(x.value)}`
        : 'ส่งฟรี';
  return c.html(
    <Admin title="คูปอง" path="/admin/coupons" msg={c.req.query('m')}>
      <h1>คูปองส่วนลด</h1>
      <div class="tbl">
        <table>
          <thead>
            <tr>
              <th>โค้ด</th>
              <th>ส่วนลด</th>
              <th>ขั้นต่ำ</th>
              <th>ช่วงเวลา</th>
              <th class="num">ใช้ไป</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((x: any) => (
              <tr class={x.active ? '' : 'dim'}>
                <td class="mono">{x.code}</td>
                <td>{desc(x)}</td>
                <td>{x.min_spend ? baht(x.min_spend) : '—'}</td>
                <td>
                  {x.starts_at ? thaiTime(x.starts_at) : 'ตอนนี้'} – {x.ends_at ? thaiTime(x.ends_at) : 'ไม่หมดอายุ'}
                </td>
                <td class="num">
                  {x.used_count}
                  {x.usage_limit != null && ` / ${x.usage_limit}`}
                </td>
                <td>
                  <form class="inline" method="post" action={`/admin/coupons/${x.id}/toggle`}>
                    <button class="linkbtn">{x.active ? 'ปิด' : 'เปิด'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section class="panel">
        <h2>สร้างคูปองใหม่</h2>
        <form class="fields" method="post" action="/admin/coupons">
          <label>
            โค้ด
            <input name="code" required maxlength={30} placeholder="SAKURA10" />
          </label>
          <label>
            ประเภท
            <select name="type">
              <option value="percent">ลดเป็น %</option>
              <option value="fixed">ลดเป็นบาท</option>
              <option value="free_shipping">ส่งฟรี</option>
            </select>
          </label>
          <label>
            มูลค่า (% หรือ บาท)
            <input name="value" inputmode="decimal" placeholder="10" />
          </label>
          <label>
            ลดสูงสุด (บาท, ถ้ามี)
            <input name="max_discount" inputmode="decimal" />
          </label>
          <label>
            ยอดซื้อขั้นต่ำ (บาท)
            <input name="min_spend" inputmode="decimal" value="0" />
          </label>
          <label>
            จำนวนครั้งที่ใช้ได้ (เว้นว่าง = ไม่จำกัด)
            <input name="usage_limit" inputmode="numeric" />
          </label>
          <label>
            เริ่ม
            <input type="datetime-local" name="starts_at" />
          </label>
          <label>
            สิ้นสุด
            <input type="datetime-local" name="ends_at" />
          </label>
          <button class="btn pri full">สร้างคูปอง</button>
        </form>
      </section>
    </Admin>,
  );
});

app.post('/coupons', async (c) => {
  const f = await c.req.parseBody();
  const code = String(f.code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 30);
  const type = ['percent', 'fixed', 'free_shipping'].includes(String(f.type)) ? String(f.type) : 'percent';
  const value = type === 'percent' ? Math.min(100, toInt(f.value)) : type === 'fixed' ? toSatang(f.value) ?? 0 : 0;
  if (!code || (type !== 'free_shipping' && value <= 0)) return c.redirect('/admin/coupons?m=invalid');
  try {
    await c.env.DB.prepare(
      'INSERT INTO coupons (code, type, value, min_spend, max_discount, starts_at, ends_at, usage_limit) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(
        code,
        type,
        value,
        toSatang(f.min_spend) ?? 0,
        toSatang(f.max_discount),
        localToIso(f.starts_at),
        localToIso(f.ends_at),
        String(f.usage_limit || '').trim() ? toInt(f.usage_limit) : null,
      )
      .run();
  } catch {
    return c.redirect('/admin/coupons?m=dup');
  }
  return c.redirect('/admin/coupons?m=created');
});

app.post('/coupons/:id/toggle', async (c) => {
  await c.env.DB.prepare('UPDATE coupons SET active = 1 - active WHERE id = ?').bind(toInt(c.req.param('id'))).run();
  return c.redirect('/admin/coupons?m=saved');
});

// ---------- ตั้งค่า ----------
app.get('/settings', async (c) => {
  const s = await getSettings(c.env.DB);
  const tiers = parseTiers(s);
  const rows = [...tiers, { max_g: 0, fee: 0 }, { max_g: 0, fee: 0 }].slice(0, Math.max(tiers.length + 1, 4));
  const m = (v: string | undefined) => (v ? (parseInt(v, 10) / 100).toString() : '0');
  return c.html(
    <Admin title="ตั้งค่าร้าน" path="/admin/settings" msg={c.req.query('m')}>
      <h1>ตั้งค่าร้าน</h1>
      <form class="fields" method="post">
        <h2 class="full">ข้อมูลร้าน</h2>
        <label>
          ชื่อร้าน
          <input name="shop_name" value={s.shop_name} required />
        </label>
        <label>
          ส่งจาก (แสดงบนการ์ดสินค้า เช่น เชียงใหม่)
          <input name="ship_from" value={s.ship_from} />
        </label>
        <label class="full">
          คำอธิบายร้าน
          <input name="tagline" value={s.tagline} />
        </label>
        <label class="full">
          ลิงก์ LINE OA สำหรับปุ่มแชท (เช่น https://lin.ee/xxxx)
          <input name="line_oa_url" value={s.line_oa_url} type="url" />
        </label>

        <h2 class="full">รับเงิน</h2>
        <label>
          พร้อมเพย์ (เบอร์มือถือหรือเลข 13 หลัก)
          <input name="promptpay_id" value={s.promptpay_id} inputmode="numeric" />
        </label>
        <label>
          ชื่อบัญชีที่แสดงให้ลูกค้า
          <input name="promptpay_name" value={s.promptpay_name} />
        </label>
        <label class="check">
          <input type="checkbox" name="cod_enabled" value="1" checked={s.cod_enabled === '1'} /> เปิดเก็บเงินปลายทาง
        </label>
        <label>
          ค่าบริการเก็บเงินปลายทาง (บาท)
          <input name="cod_fee" value={m(s.cod_fee)} inputmode="decimal" />
        </label>
        <label>
          ยกเลิกออเดอร์พร้อมเพย์ที่ไม่แนบสลิปหลัง (ชั่วโมง)
          <input name="unpaid_cancel_hours" value={s.unpaid_cancel_hours} inputmode="numeric" />
        </label>

        <h2 class="full">ค่าส่งตามน้ำหนัก</h2>
        <div class="full tbl">
          <table>
            <thead>
              <tr>
                <th>น้ำหนักรวมไม่เกิน (กรัม)</th>
                <th>ค่าส่ง (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t: ShippingTier) => (
                <tr>
                  <td>
                    <input name="tier_g" value={t.max_g || ''} inputmode="numeric" aria-label="น้ำหนักสูงสุด" />
                  </td>
                  <td>
                    <input name="tier_fee" value={t.max_g ? t.fee / 100 : ''} inputmode="decimal" aria-label="ค่าส่ง" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label>
          เกินขั้นสุดท้าย คิดเพิ่มกิโลละ (บาท)
          <input name="shipping_extra_per_kg" value={m(s.shipping_extra_per_kg)} inputmode="decimal" />
        </label>
        <label>
          ส่งฟรีเมื่อซื้อครบ (บาท, 0 = ไม่มี)
          <input name="free_shipping_min" value={m(s.free_shipping_min)} inputmode="decimal" />
        </label>

        <h2 class="full">แถบโปรโมชันหน้าร้าน</h2>
        <label class="full">
          ข้อความ (เว้นว่าง = ไม่แสดง)
          <input name="promo_text" value={s.promo_text} placeholder="ใช้โค้ด SAKURA10 ลด 10% ไม่มีขั้นต่ำ" />
        </label>
        <label>
          นับถอยหลังถึง (ถ้ามี)
          <input type="datetime-local" name="promo_ends_at" value={isoToLocal(s.promo_ends_at)} />
        </label>
        <label>
          แจ้งเตือนสินค้าใกล้หมดเมื่อเหลือไม่เกิน (ชิ้น)
          <input name="low_stock" value={s.low_stock} inputmode="numeric" />
        </label>
        <label class="full">
          การจัดส่ง การรับประกัน และการคืนสินค้า
          <textarea name="policy_text" rows={5}>
            {s.policy_text}
          </textarea>
        </label>
        <button class="btn pri full">บันทึกการตั้งค่า</button>
      </form>
    </Admin>,
  );
});

app.post('/settings', async (c) => {
  const f = await c.req.parseBody({ all: true });
  const one = (k: string) => String(arr(f[k])[0] ?? '').trim();
  const pp = one('promptpay_id').replace(/\D/g, '');
  if (pp && !(pp.length === 10 && pp.startsWith('0')) && pp.length !== 13 && pp.length !== 15)
    return c.redirect('/admin/settings?m=badpp');
  const tg = arr(f.tier_g), tf = arr(f.tier_fee);
  const tiers = tg
    .map((g, i) => ({ max_g: toInt(g), fee: toSatang(tf[i]) ?? -1 }))
    .filter((t) => t.max_g > 0 && t.fee >= 0)
    .sort((a, b) => a.max_g - b.max_g);
  const vals: Record<string, string> = {
    shop_name: one('shop_name').slice(0, 60) || 'Phasakura',
    tagline: one('tagline').slice(0, 120),
    ship_from: one('ship_from').slice(0, 40),
    line_oa_url: /^https:\/\//.test(one('line_oa_url')) ? one('line_oa_url').slice(0, 200) : '',
    promptpay_id: pp,
    promptpay_name: one('promptpay_name').slice(0, 80),
    cod_enabled: one('cod_enabled') === '1' ? '1' : '0',
    cod_fee: String(toSatang(one('cod_fee')) ?? 0),
    unpaid_cancel_hours: String(Math.max(1, toInt(one('unpaid_cancel_hours'), 24))),
    shipping_tiers: JSON.stringify(tiers),
    shipping_extra_per_kg: String(toSatang(one('shipping_extra_per_kg')) ?? 0),
    free_shipping_min: String(toSatang(one('free_shipping_min')) ?? 0),
    promo_text: one('promo_text').slice(0, 120),
    promo_ends_at: localToIso(one('promo_ends_at')) || '',
    low_stock: String(Math.max(0, toInt(one('low_stock'), 5))),
    policy_text: String(arr(f.policy_text)[0] ?? '').slice(0, 3000),
  };
  await c.env.DB.batch(
    Object.entries(vals).map(([k, v]) =>
      c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v),
    ),
  );
  return c.redirect('/admin/settings?m=saved');
});

// ---------- ธีมสี ----------
function Swatches(props: { name: string; current: string; label: string }) {
  const list = PALETTE.includes(props.current) ? PALETTE : [...PALETTE, props.current];
  return (
    <fieldset class="swatches">
      <legend>{props.label}</legend>
      <div class="sw-grid">
        {list.map((hex) => (
          <label class="sw" style={`--c:${hex}`} title={hex}>
            <input type="radio" name={props.name} value={hex} checked={hex === props.current} aria-label={hex} />
          </label>
        ))}
      </div>
      <p class="muted sw-now">
        เลือกอยู่: <span class="dot" style={`--c:${props.current}`} data-now={props.name}></span>{' '}
        <span class="mono" data-now-hex={props.name}>
          {props.current}
        </span>
      </p>
    </fieldset>
  );
}

app.get('/theme', async (c) => {
  const s = await getSettings(c.env.DB);
  const accent = isHex(s.theme_accent) ? s.theme_accent.toLowerCase() : DEFAULT_ACCENT;
  const leaf = isHex(s.theme_leaf) ? s.theme_leaf.toLowerCase() : DEFAULT_LEAF;
  const t = themeVars(accent, leaf);
  return c.html(
    <Admin title="ธีมสี" path="/admin/theme" msg={c.req.query('m')}>
      <h1>ธีมสีของเว็บ</h1>
      <p class="muted">เปลี่ยนแล้วมีผลกับหน้าร้านและหลังบ้านทันที ถ้าสีอ่อนเกินจนอ่านไม่ออก ระบบจะปรับให้เข้มขึ้นเล็กน้อยเองอัตโนมัติ</p>

      <div class="th-prev" data-theme-preview style={`--accent:${t.light.accent};--leaf:${t.light.leaf};--on-accent:${t.lightOn.accent};--on-leaf:${t.lightOn.leaf}`}>
        <div class="th-bar">
          <b class="th-brand">{s.shop_name || 'Phasakura'}</b>
          <span class="th-link">ติดตามคำสั่งซื้อ</span>
        </div>
        <div class="th-card">
          <div class="th-img"></div>
          <div>
            <div>มอนสเตอร่า ใบด่าง กระถาง 6 นิ้ว</div>
            <div>
              <span class="th-price">฿390</span> <s class="muted">฿490</s> <span class="th-off">-20%</span>{' '}
              <span class="th-free">ส่งฟรี</span>
            </div>
            <span class="th-btn">สั่งซื้อเลย</span>
          </div>
        </div>
      </div>

      <h2>ธีมสำเร็จรูป</h2>
      <form method="post" class="presets">
        {PRESETS.map((p) => (
          <button
            name="preset"
            value={p.key}
            class={'preset' + (p.accent === accent && p.leaf === leaf ? ' on' : '')}
            aria-pressed={p.accent === accent && p.leaf === leaf ? 'true' : 'false'}
          >
            <span class="pv">
              <i style={`background:${p.leaf}`}></i>
              <i style={`background:${p.accent}`}></i>
            </span>
            {p.name}
          </button>
        ))}
      </form>

      <h2>เลือกสีเอง (256 สี)</h2>
      <form method="post" class="theme-form">
        <Swatches name="accent" current={accent} label="สีหลัก: ราคา ปุ่มสั่งซื้อ ป้ายลดราคา" />
        <Swatches name="leaf" current={leaf} label="สีรอง: ชื่อร้าน ลิงก์ เมนู ป้ายส่งฟรี" />
        <button class="btn pri">บันทึกสี</button>
      </form>
    </Admin>,
  );
});

app.post('/theme', async (c) => {
  const f = await c.req.parseBody();
  const preset = PRESETS.find((p) => p.key === f.preset);
  const accent = preset ? preset.accent : String(f.accent ?? '').toLowerCase();
  const leaf = preset ? preset.leaf : String(f.leaf ?? '').toLowerCase();
  if (!isHex(accent) || !isHex(leaf)) return c.redirect('/admin/theme?m=badcolor');
  const up = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
  await c.env.DB.batch([c.env.DB.prepare(up).bind('theme_accent', accent), c.env.DB.prepare(up).bind('theme_leaf', leaf)]);
  return c.redirect('/admin/theme?m=saved');
});

// ---------- โลโก้และ SEO ----------
const BRAND_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BRAND_KEYS: Record<string, string> = { logo: 'logo_key', share: 'share_image_key' };

app.get('/seo', async (c) => {
  const s = await getSettings(c.env.DB);
  const base = c.env.SHOP_URL;
  const title = s.seo_title || `${s.shop_name} · ${s.tagline}`;
  const desc = s.seo_description || s.tagline;
  const ImgBox = (p: { kind: string; label: string; hint: string; k?: string }) => (
    <div class="brand-img">
      <div class={'bi-prev ' + p.kind}>{p.k ? <img src={imgUrl(p.k)} alt={p.label} /> : <span class="muted">ยังไม่มีรูป</span>}</div>
      <div>
        <b>{p.label}</b>
        <p class="muted">{p.hint}</p>
        <form method="post" action={`/admin/seo/image/${p.kind}`} enctype="multipart/form-data" class="row">
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label={`เลือกไฟล์${p.label}`} />
          <button class="btn pri">อัปโหลด</button>
        </form>
        {p.k && (
          <form method="post" action={`/admin/seo/image/${p.kind}/delete`} data-confirm={`ลบ${p.label}?`}>
            <button class="linkbtn neg">ลบรูปนี้</button>
          </form>
        )}
      </div>
    </div>
  );
  return c.html(
    <Admin title="โลโก้และ SEO" path="/admin/seo" msg={c.req.query('m')}>
      <h1>โลโก้และ SEO</h1>

      <h2>โลโก้</h2>
      <ImgBox
        kind="logo"
        label="โลโก้ร้าน"
        hint="แสดงที่หัวเว็บ ไอคอนแท็บเบราว์เซอร์ และใน Google แนะนำรูปสี่เหลี่ยมจัตุรัส พื้นใส (PNG) อย่างน้อย 512×512 px"
        k={s.logo_key}
      />
      <form method="post" action="/admin/seo/logo-name" class="row">
        <label class="check">
          <input type="checkbox" name="logo_hide_name" value="1" checked={s.logo_hide_name === '1'} /> ซ่อนชื่อร้านข้างโลโก้
          (ใช้เมื่อโลโก้มีชื่อร้านอยู่แล้ว)
        </label>
        <button class="btn sec">บันทึก</button>
      </form>

      <h2>รูปตอนแชร์ลิงก์</h2>
      <ImgBox
        kind="share"
        label="รูปตอนแชร์ลิงก์"
        hint="แสดงเมื่อแชร์ลิงก์หน้าร้านใน LINE หรือ Facebook ขนาดแนะนำ 1200×630 px ถ้าไม่ใส่จะใช้โลโก้แทน (หน้าสินค้าใช้รูปสินค้าเสมอ)"
        k={s.share_image_key}
      />

      <h2>SEO หน้าร้าน</h2>
      <div class="serp" aria-label="ตัวอย่างใน Google">
        <div class="serp-url">{base.replace('https://', '')}</div>
        <div class="serp-title" data-serp-title>
          {title}
        </div>
        <div class="serp-desc" data-serp-desc>
          {desc}
        </div>
      </div>
      <form class="fields" method="post" action="/admin/seo">
        <label class="full">
          ชื่อหน้าเว็บใน Google (ไม่เกิน 60 ตัวอักษร)
          <input name="seo_title" value={s.seo_title} maxlength={70} placeholder={`${s.shop_name} · ${s.tagline}`} data-serp-in="title" />
        </label>
        <label class="full">
          คำอธิบายใต้ชื่อใน Google (ไม่เกิน 160 ตัวอักษร)
          <textarea name="seo_description" rows={3} maxlength={200} placeholder={s.tagline} data-serp-in="desc">
            {s.seo_description}
          </textarea>
        </label>
        <label class="full">
          รหัสยืนยัน Google Search Console (วางทั้งแท็ก meta หรือเฉพาะรหัสก็ได้)
          <input name="google_site_verification" value={s.google_site_verification} placeholder='<meta name="google-site-verification" content="..." />' />
        </label>
        <button class="btn pri full">บันทึก SEO</button>
      </form>

      <div class="box seo-auto">
        <b>ระบบทำให้อัตโนมัติแล้ว</b>
        <ul>
          <li>หน้าสินค้าใช้ชื่อสินค้า คำอธิบาย ราคา และรูป เป็นข้อมูลสำหรับ Google และตอนแชร์ลิงก์</li>
          <li>ข้อมูลสินค้าแบบ Google Shopping (ราคา สต็อก รูป หมวดหมู่) ฝังอยู่ในทุกหน้าสินค้า</li>
          <li>
            แผนผังเว็บ <a href="/sitemap.xml" target="_blank">{base}/sitemap.xml</a> อัปเดตเองเมื่อเพิ่มสินค้า
          </li>
          <li>หน้าตะกร้า คำสั่งซื้อ หลังบ้าน และผลค้นหา ถูกกันไม่ให้ Google เก็บ</li>
        </ul>
        <p class="muted">
          ขั้นต่อไปที่แนะนำ: เพิ่มเว็บใน{' '}
          <a href="https://search.google.com/search-console" target="_blank" rel="noopener">
            Google Search Console
          </a>{' '}
          ยืนยันด้วยรหัสด้านบน แล้วส่ง sitemap ลิงก์ด้านบน
        </p>
      </div>
    </Admin>,
  );
});

const upsert = (db: D1Database, k: string, v: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v);

app.post('/seo', async (c) => {
  const f = await c.req.parseBody();
  const one = (k: string) => String(f[k] ?? '').replace(/\s+/g, ' ').trim();
  let gv = one('google_site_verification');
  const m = gv.match(/content=["']([^"']+)["']/);
  if (m) gv = m[1];
  gv = gv.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 100);
  await c.env.DB.batch([
    upsert(c.env.DB, 'seo_title', one('seo_title').slice(0, 70)),
    upsert(c.env.DB, 'seo_description', one('seo_description').slice(0, 200)),
    upsert(c.env.DB, 'google_site_verification', gv),
  ]);
  return c.redirect('/admin/seo?m=saved');
});

app.post('/seo/logo-name', async (c) => {
  const f = await c.req.parseBody();
  await upsert(c.env.DB, 'logo_hide_name', f.logo_hide_name === '1' ? '1' : '0').run();
  return c.redirect('/admin/seo?m=saved');
});

app.post('/seo/image/:kind', async (c) => {
  const setting = BRAND_KEYS[c.req.param('kind')];
  if (!setting) return c.notFound();
  const f = await c.req.parseBody();
  const file = f.file;
  if (!(file instanceof File) || !BRAND_TYPES[file.type] || file.size === 0 || file.size > 2 * 1024 * 1024)
    return c.redirect('/admin/seo?m=badimg');
  const key = `brand/${c.req.param('kind')}-${randomToken(6)}.${BRAND_TYPES[file.type]}`;
  await c.env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const old = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(setting).first<{ value: string }>();
  await upsert(c.env.DB, setting, key).run();
  if (old?.value?.startsWith('brand/')) await c.env.BUCKET.delete(old.value);
  return c.redirect('/admin/seo?m=uploaded');
});

app.post('/seo/image/:kind/delete', async (c) => {
  const setting = BRAND_KEYS[c.req.param('kind')];
  if (!setting) return c.notFound();
  const old = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(setting).first<{ value: string }>();
  await upsert(c.env.DB, setting, '').run();
  if (old?.value?.startsWith('brand/')) await c.env.BUCKET.delete(old.value);
  return c.redirect('/admin/seo?m=removed');
});

export default app;
