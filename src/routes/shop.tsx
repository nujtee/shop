import { Hono } from 'hono';
import { raw } from 'hono/html';
import { Env, baht, formatSold, ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD, thaiTime, randomToken, nowIso } from '../lib/util';
import { getSettings, Settings, parseTiers } from '../lib/store';
import { promptPayPayload, qrSvg } from '../lib/promptpay';
import { notifyLine } from '../lib/line';
import { Shell, ShopHeader, ShopFooter, imgUrl } from '../views/layout';

const app = new Hono<{ Bindings: Env }>();

type Card = {
  id: number;
  name: string;
  slug: string;
  badge: string;
  sold_count: number;
  price: number;
  compare_at: number | null;
  stock: number;
  image_key: string | null;
};

const SORTS: [string, string][] = [
  ['', 'แนะนำ'],
  ['best', 'ขายดี'],
  ['new', 'มาใหม่'],
  ['price_asc', 'ราคา ↑'],
  ['price_desc', 'ราคา ↓'],
];
const CHIPS: [string, string][] = [
  ['sale', 'ลดราคา'],
  ['instock', 'พร้อมส่ง'],
  ['lt100', 'ต่ำกว่า ฿100'],
  ['100-500', '฿100 - ฿500'],
  ['gt500', '฿500 ขึ้นไป'],
];
const PRICE_CHIPS = ['lt100', '100-500', 'gt500'];

function ProductCard({ p, s }: { p: Card; s: Settings }) {
  const pct = p.compare_at && p.compare_at > p.price ? Math.round((1 - p.price / p.compare_at) * 100) : 0;
  const freeMin = parseInt(s.free_shipping_min || '0', 10);
  return (
    <a class="card" href={`/p/${encodeURIComponent(p.slug)}`}>
      <div class="img">
        {p.image_key ? <img src={imgUrl(p.image_key)} alt={p.name} loading="lazy" /> : <span class="noimg">🌱</span>}
        {pct > 0 && <span class="off">-{pct}%</span>}
        {p.stock <= 0 && <span class="soldout">สินค้าหมด</span>}
      </div>
      <div class="info">
        <div class="ttl">
          {p.badge && <span class="tag">{p.badge}</span>}
          {p.name}
        </div>
        <div class="price">
          {baht(p.price)}
          {pct > 0 && <s>{baht(p.compare_at!)}</s>}
        </div>
        {pct > 0 && (
          <div class="pills">
            <span class="pill">ลด {pct}%</span>
          </div>
        )}
        <div class="meta">
          {p.sold_count > 0 ? `ขายได้ ${formatSold(p.sold_count)} ชิ้น` : 'สินค้าใหม่'}
        </div>
        <div class="meta">
          {freeMin > 0 && <span class="free">ส่งฟรี*</span>}
          {s.ship_from && <span>📍 {s.ship_from}</span>}
        </div>
      </div>
    </a>
  );
}

function PromoBar({ s }: { s: Settings }) {
  if (!s.promo_text) return null;
  const active = !s.promo_ends_at || s.promo_ends_at > nowIso();
  if (!active) return null;
  return (
    <div class="promo">
      <span class="promo-ic" aria-hidden="true">
        %
      </span>
      <span>{s.promo_text}</span>
      {s.promo_ends_at && <div class="cd" data-countdown={s.promo_ends_at}></div>}
    </div>
  );
}

app.get('/', async (c) => {
  const s = await getSettings(c.env.DB);
  const url = new URL(c.req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const cat = url.searchParams.get('c') || '';
  const sort = url.searchParams.get('sort') || '';
  const chips = new Set((url.searchParams.get('f') || '').split(',').filter((x) => CHIPS.some((k) => k[0] === x)));
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const PER = 40;

  const { results: cats } = await c.env.DB.prepare('SELECT name, slug FROM categories ORDER BY sort_order, id').all<{
    name: string;
    slug: string;
  }>();

  const where = ["p.status = 'active'"];
  const binds: unknown[] = [];
  if (cat) {
    where.push('c.slug = ?');
    binds.push(cat);
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const having: string[] = [];
  if (chips.has('sale')) having.push('compare_at > price');
  if (chips.has('instock')) having.push('stock > 0');
  if (chips.has('lt100')) having.push('price < 10000');
  if (chips.has('100-500')) having.push('price BETWEEN 10000 AND 50000');
  if (chips.has('gt500')) having.push('price > 50000');
  const order =
    {
      best: 'p.sold_count DESC, p.id DESC',
      new: 'p.created_at DESC',
      price_asc: 'price ASC',
      price_desc: 'price DESC',
    }[sort] || '(stock > 0) DESC, p.is_featured DESC, p.sold_count DESC, p.id DESC';

  const { results: products } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.badge, p.sold_count, p.is_featured, p.created_at,
       MIN(v.price) AS price,
       (SELECT compare_at_price FROM variants v2 WHERE v2.product_id = p.id AND v2.active = 1 ORDER BY v2.price LIMIT 1) AS compare_at,
       SUM(v.stock) AS stock,
       (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_key
     FROM products p
     JOIN variants v ON v.product_id = p.id AND v.active = 1
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')}
     GROUP BY p.id
     ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, PER + 1, (page - 1) * PER)
    .all<Card>();
  const hasMore = products.length > PER;
  const catName = cats.find((x) => x.slug === cat)?.name || '';

  const link = (patch: Record<string, string | null>) => {
    const u = new URL(url.toString());
    u.searchParams.delete('page');
    for (const [k, v] of Object.entries(patch)) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
    return u.pathname + (u.search || '');
  };
  const toggleChip = (k: string) => {
    const next = new Set(chips);
    if (next.has(k)) next.delete(k);
    else {
      if (PRICE_CHIPS.includes(k)) PRICE_CHIPS.forEach((x) => next.delete(x));
      next.add(k);
    }
    return link({ f: [...next].join(',') || null });
  };

  return c.html(
    <Shell
      s={s}
      title={catName ? `${catName} · ${s.shop_name}` : s.seo_title || `${s.shop_name} · ${s.tagline}`}
      description={s.seo_description || s.tagline}
      url={c.env.SHOP_URL + (cat && catName ? `/?c=${encodeURIComponent(cat)}` : '/')}
      noindex={!!q || page > 1 || !!sort || chips.size > 0 || (!!cat && !catName)}
      jsonLd={
        cat
          ? []
          : [
              {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                name: s.shop_name,
                url: c.env.SHOP_URL + '/',
                potentialAction: {
                  '@type': 'SearchAction',
                  target: c.env.SHOP_URL + '/?q={search_term_string}',
                  'query-input': 'required name=search_term_string',
                },
              },
              {
                '@context': 'https://schema.org',
                '@type': 'Store',
                name: s.shop_name,
                description: s.seo_description || s.tagline,
                url: c.env.SHOP_URL + '/',
                ...(s.logo_key ? { logo: c.env.SHOP_URL + imgUrl(s.logo_key), image: c.env.SHOP_URL + imgUrl(s.logo_key) } : {}),
                ...(s.line_oa_url ? { sameAs: [s.line_oa_url] } : {}),
              },
            ]
      }
    >
      <div class="phone-wrap">
        <ShopHeader s={s} q={q} />
        <nav class="cats" aria-label="หมวดหมู่">
          <a href={link({ c: null })} class={!cat ? 'on' : ''}>
            ทั้งหมด
          </a>
          {cats.map((x) => (
            <a href={link({ c: x.slug })} class={cat === x.slug ? 'on' : ''}>
              {x.name}
            </a>
          ))}
        </nav>
        <nav class="sorts" aria-label="เรียงลำดับ">
          {SORTS.map(([k, label]) => (
            <a href={link({ sort: k || null })} class={sort === k ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <div class="chips">
          {CHIPS.map(([k, label]) => (
            <a class={`chip ${chips.has(k) ? 'on' : ''}`} href={toggleChip(k)}>
              {label}
            </a>
          ))}
        </div>
        <PromoBar s={s} />
        {q && (
          <p class="result-note">
            ผลการค้นหา “{q}” · <a href={link({ q: null })}>ล้างคำค้น</a>
          </p>
        )}
        <main class="grid">
          {products.slice(0, PER).map((p) => (
            <ProductCard p={p} s={s} />
          ))}
          {!products.length && (
            <p class="empty">
              ไม่พบสินค้าที่ตรงกับเงื่อนไข <a href="/">ดูสินค้าทั้งหมด</a>
            </p>
          )}
        </main>
        {hasMore && (
          <div class="more">
            <a class="btn ghost" href={link({ page: String(page + 1) })}>
              ดูสินค้าเพิ่ม
            </a>
          </div>
        )}
        <ShopFooter s={s} />
      </div>
    </Shell>,
  );
});

app.get('/p/:slug', async (c) => {
  const s = await getSettings(c.env.DB);
  const slug = c.req.param('slug');
  const p = await c.env.DB.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p
     LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = ? AND p.status = 'active'`,
  )
    .bind(slug)
    .first<any>();
  if (!p) return c.notFound();
  const [{ results: variants }, { results: images }] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, name, price, compare_at_price, stock, weight_g FROM variants WHERE product_id = ? AND active = 1 ORDER BY sort_order, id',
    )
      .bind(p.id)
      .all<any>(),
    c.env.DB.prepare('SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY sort_order, id').bind(p.id).all<any>(),
  ]);
  if (!variants.length) return c.notFound();
  const first = variants.find((v) => v.stock > 0) || variants[0];
  const pct = first.compare_at_price > first.price ? Math.round((1 - first.price / first.compare_at_price) * 100) : 0;
  const freeMin = parseInt(s.free_shipping_min || '0', 10);
  const promoActive = s.promo_text && (!s.promo_ends_at || s.promo_ends_at > nowIso());
  const tiers = parseTiers(s);
  const ogImage = images[0] ? new URL(imgUrl(images[0].r2_key), c.env.SHOP_URL).toString() : undefined;
  const pageUrl = `${c.env.SHOP_URL}/p/${encodeURIComponent(p.slug)}`;
  const plain = p.description.replace(/\s+/g, ' ').trim();
  const metaDesc = (
    plain
      ? plain
      : `${p.name} ราคา ${baht(first.price)}${p.category_name ? ` หมวด${p.category_name}` : ''}${s.ship_from ? ` ส่งจาก${s.ship_from}` : ''} สั่งซื้อออนไลน์ที่ ${s.shop_name}`
  ).slice(0, 160);

  return c.html(
    <Shell
      s={s}
      title={`${p.name} · ${s.shop_name}`}
      description={metaDesc}
      image={ogImage}
      url={pageUrl}
      ogType="product"
      jsonLd={[
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: p.name,
          description: metaDesc,
          url: pageUrl,
          image: images.map((im: any) => c.env.SHOP_URL + imgUrl(im.r2_key)),
          brand: { '@type': 'Brand', name: s.shop_name },
          ...(p.category_name ? { category: p.category_name } : {}),
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'THB',
            lowPrice: (Math.min(...variants.map((v: any) => v.price)) / 100).toFixed(2),
            highPrice: (Math.max(...variants.map((v: any) => v.price)) / 100).toFixed(2),
            offerCount: variants.length,
            availability: variants.some((v: any) => v.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: pageUrl,
          },
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: s.shop_name, item: c.env.SHOP_URL + '/' },
            ...(p.category_slug
              ? [{ '@type': 'ListItem', position: 2, name: p.category_name, item: `${c.env.SHOP_URL}/?c=${encodeURIComponent(p.category_slug)}` }]
              : []),
            { '@type': 'ListItem', position: p.category_slug ? 3 : 2, name: p.name, item: pageUrl },
          ],
        },
      ]}
    >
      <div class="phone-wrap pd">
        <ShopHeader s={s} back />
        <div class="gallery" aria-label="รูปสินค้า">
          {images.length ? (
            images.map((im: any, i: number) => (
              <img src={imgUrl(im.r2_key)} alt={`${p.name} รูปที่ ${i + 1}`} loading={i ? 'lazy' : 'eager'} />
            ))
          ) : (
            <div class="noimg big">🌱</div>
          )}
        </div>
        {images.length > 1 && <div class="gallery-count">เลื่อนดูรูป {images.length} รูป</div>}
        <div class={`pd-price ${pct ? 'sale' : ''}`}>
          <div>
            <span class="big" data-price>
              {baht(first.price)}
            </span>
            <s data-compare hidden={!pct}>
              {pct ? baht(first.compare_at_price) : ''}
            </s>
            <span class="pct" data-pct hidden={!pct}>
              {pct ? `-${pct}%` : ''}
            </span>
          </div>
          {promoActive && s.promo_ends_at && (
            <div class="pd-cd">
              {s.promo_text}
              <br />
              สิ้นสุดใน <b data-countdown={s.promo_ends_at} data-plain="1"></b>
            </div>
          )}
        </div>
        <div class="pd-body">
          <h1>
            {p.badge && <span class="tag">{p.badge}</span>}
            {p.name}
          </h1>
          <div class="meta">
            {p.sold_count > 0 ? `ขายได้ ${formatSold(p.sold_count)} ชิ้น` : 'สินค้าใหม่'}
            {p.category_name && (
              <>
                {' · '}
                <a href={`/?c=${encodeURIComponent(p.category_slug)}`}>{p.category_name}</a>
              </>
            )}
          </div>
          <form class="buy" data-buy>
            {variants.length > 1 && (
              <fieldset class="opts">
                <legend>ตัวเลือก</legend>
                {variants.map((v: any) => (
                  <label class={`opt ${v.stock <= 0 ? 'out' : ''}`}>
                    <input
                      type="radio"
                      name="variant"
                      value={v.id}
                      checked={v.id === first.id}
                      disabled={v.stock <= 0}
                      data-price={baht(v.price)}
                      data-compare={v.compare_at_price > v.price ? baht(v.compare_at_price) : ''}
                      data-pct={v.compare_at_price > v.price ? `-${Math.round((1 - v.price / v.compare_at_price) * 100)}%` : ''}
                      data-stock={v.stock}
                    />
                    <span>
                      {v.name}
                      {v.stock <= 0 && ' (หมด)'}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {variants.length === 1 && <input type="hidden" name="variant" value={first.id} data-stock={first.stock} />}
            <div class="qty-row">
              <span>จำนวน</span>
              <div class="qty">
                <button type="button" data-step="-1" aria-label="ลดจำนวน">
                  −
                </button>
                <input name="qty" type="number" min="1" value="1" inputmode="numeric" aria-label="จำนวน" />
                <button type="button" data-step="1" aria-label="เพิ่มจำนวน">
                  +
                </button>
              </div>
              <span class="muted" data-stock-label>
                {first.stock > 0 ? `เหลือ ${first.stock} ชิ้น` : 'สินค้าหมด'}
              </span>
            </div>
            <div class="buybar">
              {s.line_oa_url ? (
                <a class="btn ghost" href={s.line_oa_url} target="_blank" rel="noopener" aria-label="แชทกับร้านทาง LINE">
                  แชท
                </a>
              ) : (
                <span></span>
              )}
              <button class="btn sec" type="submit" name="action" value="add" disabled={first.stock <= 0}>
                ใส่ตะกร้า
              </button>
              <button class="btn pri" type="submit" name="action" value="buy" disabled={first.stock <= 0}>
                ซื้อเลย
              </button>
            </div>
          </form>
          <section>
            <div class="row">
              <span>ค่าจัดส่ง</span>
              <span>
                คิดตามน้ำหนัก เริ่มต้น {tiers[0] ? baht(tiers[0].fee) : 'ฟรี'}
                {freeMin > 0 && ` · ส่งฟรีเมื่อซื้อครบ ${baht(freeMin)}`}
              </span>
            </div>
            <div class="row">
              <span>ชำระเงิน</span>
              <span>พร้อมเพย์{s.cod_enabled === '1' && ' · เก็บเงินปลายทาง'}</span>
            </div>
            {s.ship_from && (
              <div class="row">
                <span>ส่งจาก</span>
                <span>{s.ship_from}</span>
              </div>
            )}
          </section>
          {p.description && (
            <section class="desc">
              <h2>รายละเอียดสินค้า</h2>
              <div class="prewrap">{p.description}</div>
            </section>
          )}
        </div>
        <ShopFooter s={s} />
      </div>
    </Shell>,
  );
});

app.get('/cart', async (c) => {
  const s = await getSettings(c.env.DB);
  return c.html(
    <Shell s={s} noindex title={`ตะกร้าสินค้า · ${s.shop_name}`}>
      <div class="phone-wrap">
        <ShopHeader s={s} back />
        <div id="cart-app" data-cod={s.cod_enabled === '1' ? '1' : '0'} data-promptpay={s.promptpay_id ? '1' : '0'}>
          <h1 class="sec-h">ตะกร้าของฉัน</h1>
          <div data-lines>
            <p class="empty">กำลังโหลดตะกร้า…</p>
          </div>
          <form id="checkout" hidden>
            <div class="coupon">
              <input name="coupon" placeholder="โค้ดส่วนลด" aria-label="โค้ดส่วนลด" autocomplete="off" />
              <button type="button" class="btn ghost" data-apply-coupon>
                ใช้โค้ด
              </button>
            </div>
            <p class="err" data-coupon-msg hidden></p>
            <h2 class="sec-h">ที่อยู่จัดส่ง</h2>
            <div class="fields">
              <label>
                ชื่อผู้รับ
                <input name="customer_name" required autocomplete="name" maxlength={100} />
              </label>
              <label>
                เบอร์โทร
                <input name="phone" required inputmode="tel" autocomplete="tel" maxlength={20} />
              </label>
              <label class="full">
                บ้านเลขที่ ถนน หมู่บ้าน
                <input name="address_line" required autocomplete="street-address" maxlength={300} />
              </label>
              <label>
                ตำบล/แขวง
                <input name="subdistrict" maxlength={80} />
              </label>
              <label>
                อำเภอ/เขต
                <input name="district" maxlength={80} />
              </label>
              <label>
                จังหวัด
                <input name="province" required maxlength={60} />
              </label>
              <label>
                รหัสไปรษณีย์
                <input name="postcode" required inputmode="numeric" pattern="\d{5}" maxlength={5} autocomplete="postal-code" />
              </label>
              <label class="full">
                หมายเหตุถึงร้าน (ถ้ามี)
                <input name="note" maxlength={500} />
              </label>
            </div>
            <h2 class="sec-h">ชำระเงิน</h2>
            <div class="pay">
              {s.promptpay_id && (
                <label>
                  <input type="radio" name="payment_method" value="promptpay" checked />
                  <span>
                    พร้อมเพย์ <small>สแกน QR แล้วแนบสลิป</small>
                  </span>
                </label>
              )}
              {s.cod_enabled === '1' && (
                <label>
                  <input type="radio" name="payment_method" value="cod" checked={!s.promptpay_id} />
                  <span>
                    เก็บเงินปลายทาง{' '}
                    {parseInt(s.cod_fee || '0', 10) > 0 && <small>ค่าบริการ {baht(parseInt(s.cod_fee, 10))}</small>}
                  </span>
                </label>
              )}
            </div>
            <div class="sum" data-sum></div>
            <p class="err" data-err hidden></p>
            <button class="btn pri wide" type="submit" data-submit>
              สั่งซื้อ
            </button>
          </form>
        </div>
        <ShopFooter s={s} />
      </div>
    </Shell>,
  );
});

async function loadOrder(db: D1Database, no: string, key: string | undefined) {
  const o = await db.prepare('SELECT * FROM orders WHERE order_no = ?').bind(no).first<any>();
  if (!o || !key || key !== o.access_key) return null;
  const { results: items } = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(o.id).all<any>();
  return { o, items };
}

const STEPS = ['awaiting_payment', 'to_pack', 'packing', 'shipped', 'delivered'];

app.get('/order/:no', async (c) => {
  const s = await getSettings(c.env.DB);
  const data = await loadOrder(c.env.DB, c.req.param('no'), c.req.query('k'));
  if (!data) return c.notFound();
  const { o, items } = data;
  const msg = c.req.query('m');
  const steps = o.payment_method === 'cod' ? STEPS.slice(1) : STEPS;
  const idx = steps.indexOf(o.status);
  let qr = '';
  if (o.payment_method === 'promptpay' && o.payment_status === 'awaiting' && o.status === 'awaiting_payment' && s.promptpay_id) {
    try {
      qr = qrSvg(promptPayPayload(s.promptpay_id, o.total));
    } catch {
      qr = '';
    }
  }
  const self = `/order/${o.order_no}?k=${o.access_key}`;
  return c.html(
    <Shell s={s} noindex title={`คำสั่งซื้อ ${o.order_no} · ${s.shop_name}`}>
      <div class="phone-wrap">
        <ShopHeader s={s} back />
        <div class="order">
          {msg === 'placed' && <p class="ok">ได้รับคำสั่งซื้อแล้ว บันทึกลิงก์หน้านี้ไว้เพื่อติดตามสถานะ</p>}
          {msg === 'slip' && <p class="ok">ได้รับสลิปแล้ว ร้านจะตรวจและแพ็คของให้เร็วที่สุด</p>}
          {msg === 'sliperr' && <p class="err">อัปโหลดสลิปไม่สำเร็จ ใช้ไฟล์รูป JPG หรือ PNG ขนาดไม่เกิน 8 MB</p>}
          <h1>คำสั่งซื้อ {o.order_no}</h1>
          <p class="muted">สั่งเมื่อ {thaiTime(o.created_at)}</p>
          {o.status === 'cancelled' ? (
            <p class="err">ออเดอร์นี้ถูกยกเลิกแล้ว</p>
          ) : (
            <ol class="steps">
              {steps.map((st, i) => (
                <li class={i <= idx ? 'done' : ''}>{ORDER_STATUS[st]}</li>
              ))}
            </ol>
          )}
          {o.tracking_no && (
            <div class="box">
              <b>เลขพัสดุ</b> {o.carrier} <span class="mono">{o.tracking_no}</span>
            </div>
          )}
          {qr && (
            <div class="box paybox">
              <h2>สแกนจ่ายด้วยพร้อมเพย์</h2>
              <div class="qr">{raw(qr)}</div>
              <div class="big">{baht(o.total)}</div>
              {s.promptpay_name && <div class="muted">ชื่อบัญชี {s.promptpay_name}</div>}
              <p class="muted">บันทึกรูปหน้าจอ QR แล้วเปิดแอปธนาคารเพื่อสแกนได้ จากนั้นแนบสลิปด้านล่าง</p>
              <form method="post" action={`/order/${o.order_no}/slip?k=${o.access_key}`} enctype="multipart/form-data" class="slip">
                <input type="file" name="slip" accept="image/*" required aria-label="ไฟล์สลิป" />
                <button class="btn pri wide" type="submit">
                  แนบสลิป
                </button>
              </form>
            </div>
          )}
          {o.payment_status === 'slip_uploaded' && <p class="box">แนบสลิปแล้ว รอร้านตรวจสอบ</p>}
          <h2 class="sec-h">สินค้า</h2>
          {items.map((it: any) => (
            <div class="ci">
              <div class="th">{it.image_key ? <img src={imgUrl(it.image_key)} alt="" /> : '🌱'}</div>
              <div>
                <div class="ttl">{it.product_name}</div>
                <div class="muted">
                  {it.variant_name} × {it.qty}
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
              <span>ค่าส่ง ({(o.total_weight_g / 1000).toFixed(1)} กก.)</span>
              <span>{o.shipping_fee ? baht(o.shipping_fee) : 'ฟรี'}</span>
            </div>
            {o.cod_fee > 0 && (
              <div>
                <span>ค่าบริการเก็บเงินปลายทาง</span>
                <span>{baht(o.cod_fee)}</span>
              </div>
            )}
            <div class="tot">
              <span>รวม</span>
              <span>{baht(o.total)}</span>
            </div>
            <div class="muted">
              {PAYMENT_METHOD[o.payment_method]} · {PAYMENT_STATUS[o.payment_status]}
            </div>
          </div>
          <h2 class="sec-h">จัดส่งถึง</h2>
          <p class="box">
            {o.customer_name} · {o.phone}
            <br />
            {o.address_line} {o.subdistrict} {o.district} {o.province} {o.postcode}
          </p>
          <p class="muted">
            ลิงก์ของออเดอร์นี้: <a href={self}>{new URL(self, c.env.SHOP_URL).toString()}</a>
          </p>
        </div>
        <ShopFooter s={s} />
      </div>
    </Shell>,
  );
});

app.post('/order/:no/slip', async (c) => {
  const no = c.req.param('no');
  const key = c.req.query('k');
  const data = await loadOrder(c.env.DB, no, key);
  if (!data) return c.notFound();
  const { o } = data;
  const back = `/order/${o.order_no}?k=${o.access_key}`;
  if (o.status !== 'awaiting_payment' || o.payment_method !== 'promptpay') return c.redirect(back);
  const form = await c.req.parseBody();
  const f = form.slip;
  if (!(f instanceof File) || !f.type.startsWith('image/') || f.size > 8 * 1024 * 1024 || f.size === 0)
    return c.redirect(back + '&m=sliperr');
  const ext = (f.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '').slice(0, 5);
  const r2key = `slips/${o.order_no}/${randomToken(6)}.${ext}`;
  await c.env.BUCKET.put(r2key, f.stream(), { httpMetadata: { contentType: f.type } });
  await c.env.DB.prepare(
    `UPDATE orders SET slip_key = ?, payment_status = 'slip_uploaded', updated_at = ? WHERE id = ? AND status = 'awaiting_payment'`,
  )
    .bind(r2key, nowIso(), o.id)
    .run();
  c.executionCtx.waitUntil(
    notifyLine(
      c.env,
      `📎 แนบสลิปแล้ว ${o.order_no}\n${o.customer_name} ยอด ${baht(o.total)}\nตรวจสลิป: ${c.env.SHOP_URL}/admin/orders/${o.id}`,
    ),
  );
  return c.redirect(back + '&m=slip');
});

app.get('/track', async (c) => {
  const s = await getSettings(c.env.DB);
  const no = (c.req.query('no') || '').trim().toUpperCase();
  const phone = (c.req.query('phone') || '').replace(/\D/g, '');
  let error = '';
  if (no && phone) {
    const o = await c.env.DB.prepare('SELECT order_no, access_key, phone FROM orders WHERE order_no = ?').bind(no).first<any>();
    if (o && o.phone.replace(/\D/g, '') === phone) return c.redirect(`/order/${o.order_no}?k=${o.access_key}`);
    error = 'ไม่พบคำสั่งซื้อ ตรวจเลขคำสั่งซื้อและเบอร์โทรอีกครั้ง';
  }
  return c.html(
    <Shell s={s} noindex title={`ติดตามคำสั่งซื้อ · ${s.shop_name}`}>
      <div class="phone-wrap">
        <ShopHeader s={s} back />
        <form class="order fields" method="get">
          <h1 class="full">ติดตามคำสั่งซื้อ</h1>
          <label class="full">
            เลขคำสั่งซื้อ
            <input name="no" value={no} placeholder="เช่น PS261118ABCD" required />
          </label>
          <label class="full">
            เบอร์โทรที่ใช้สั่งซื้อ
            <input name="phone" value={c.req.query('phone') || ''} inputmode="tel" required />
          </label>
          {error && <p class="err full">{error}</p>}
          <button class="btn pri full" type="submit">
            ค้นหา
          </button>
        </form>
        <ShopFooter s={s} />
      </div>
    </Shell>,
  );
});

app.get('/policy', async (c) => {
  const s = await getSettings(c.env.DB);
  const tiers = parseTiers(s);
  return c.html(
    <Shell s={s} url={c.env.SHOP_URL + '/policy'} title={`การจัดส่งและการรับประกัน · ${s.shop_name}`}>
      <div class="phone-wrap">
        <ShopHeader s={s} back />
        <div class="order">
          <h1>การจัดส่งและการรับประกัน</h1>
          <h2 class="sec-h">ค่าจัดส่งตามน้ำหนัก</h2>
          <div class="sum">
            {tiers.map((t, i) => (
              <div>
                <span>
                  {i === 0 ? 'ไม่เกิน ' : `${(tiers[i - 1].max_g / 1000).toLocaleString('th-TH')} – `}
                  {(t.max_g / 1000).toLocaleString('th-TH')} กก.
                </span>
                <span>{baht(t.fee)}</span>
              </div>
            ))}
            {parseInt(s.shipping_extra_per_kg || '0', 10) > 0 && tiers.length > 0 && (
              <div>
                <span>เกิน {(tiers[tiers.length - 1].max_g / 1000).toLocaleString('th-TH')} กก.</span>
                <span>เพิ่มกิโลละ {baht(parseInt(s.shipping_extra_per_kg, 10))}</span>
              </div>
            )}
            {parseInt(s.free_shipping_min || '0', 10) > 0 && (
              <div>
                <span>ส่งฟรีเมื่อซื้อครบ</span>
                <span>{baht(parseInt(s.free_shipping_min, 10))}</span>
              </div>
            )}
          </div>
          <h2 class="sec-h">การรับประกันและการคืนสินค้า</h2>
          <p class="prewrap">{s.policy_text}</p>
          <h2 class="sec-h">ข้อมูลส่วนบุคคล</h2>
          <p>ร้านใช้ชื่อ เบอร์โทร และที่อยู่ของคุณเพื่อจัดส่งสินค้าและติดต่อเรื่องคำสั่งซื้อเท่านั้น ไม่ส่งต่อให้ผู้อื่นนอกจากบริษัทขนส่ง</p>
        </div>
        <ShopFooter s={s} />
      </div>
    </Shell>,
  );
});

// sitemap สำหรับ Google
app.get('/sitemap.xml', async (c) => {
  const base = c.env.SHOP_URL;
  const [{ results: prods }, { results: cats }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.slug, p.updated_at,
         (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_key
       FROM products p WHERE p.status = 'active'
         AND EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1)
       ORDER BY p.id DESC LIMIT 5000`,
    ).all<{ slug: string; updated_at: string; image_key: string | null }>(),
    c.env.DB.prepare('SELECT slug FROM categories ORDER BY sort_order, id').all<{ slug: string }>(),
  ]);
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const u = (loc: string, extra = '') => `<url><loc>${esc(loc)}</loc>${extra}</url>`;
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' +
    u(base + '/') +
    cats.map((k) => u(`${base}/?c=${encodeURIComponent(k.slug)}`)).join('') +
    prods
      .map((p) =>
        u(
          `${base}/p/${encodeURIComponent(p.slug)}`,
          `<lastmod>${esc(p.updated_at.slice(0, 10))}</lastmod>` +
            (p.image_key ? `<image:image><image:loc>${esc(base + imgUrl(p.image_key))}</image:loc></image:image>` : ''),
        ),
      )
      .join('') +
    u(base + '/policy') +
    '</urlset>';
  return c.body(xml, 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
});

// รูปสินค้าและโลโก้จาก R2 (สลิปไม่เปิดสาธารณะ)
app.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice('/media/'.length));
  if (!key.startsWith('products/') && !key.startsWith('brand/')) return c.notFound();
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('cache-control', 'public, max-age=31536000, immutable');
  h.set('etag', obj.httpEtag);
  h.set('x-content-type-options', 'nosniff');
  h.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  return new Response(obj.body, { headers: h });
});

export default app;
