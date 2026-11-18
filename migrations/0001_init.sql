-- เงินทุกช่องเก็บเป็นสตางค์ (จำนวนเต็ม) เวลาเก็บเป็น ISO 8601 UTC

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  badge TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_products_category ON products(category_id, status);

CREATE TABLE variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'มาตรฐาน',
  price INTEGER NOT NULL CHECK (price >= 0),
  compare_at_price INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  weight_g INTEGER NOT NULL DEFAULT 500,
  sku TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_variants_product ON variants(product_id);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_product ON product_images(product_id, sort_order);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  access_key TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_line TEXT NOT NULL,
  subdistrict TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL,
  postcode TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('promptpay', 'cod')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('awaiting', 'slip_uploaded', 'paid', 'cod', 'refunded')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'to_pack', 'packing', 'shipped', 'delivered', 'cancelled')),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  cod_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  total_weight_g INTEGER NOT NULL DEFAULT 0,
  coupon_code TEXT,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_no TEXT NOT NULL DEFAULT '',
  slip_key TEXT,
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT,
  shipped_at TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_phone ON orders(phone);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  variant_id INTEGER,
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  image_key TEXT
);
CREATE INDEX idx_items_order ON order_items(order_id);

CREATE TABLE coupons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed', 'free_shipping')),
  value INTEGER NOT NULL DEFAULT 0,
  min_spend INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL,
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_moves_variant ON stock_movements(variant_id, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('shop_name', 'Phasakura'),
  ('tagline', 'ต้นไม้ กล้าไม้ ดิน และกระถาง ส่งทั่วไทย'),
  ('ship_from', ''),
  ('promptpay_id', ''),
  ('promptpay_name', ''),
  ('shipping_tiers', '[{"max_g":1000,"fee":4500},{"max_g":3000,"fee":6500},{"max_g":5000,"fee":8500},{"max_g":10000,"fee":12000}]'),
  ('shipping_extra_per_kg', '1500'),
  ('free_shipping_min', '0'),
  ('cod_enabled', '1'),
  ('cod_fee', '2000'),
  ('promo_text', ''),
  ('promo_ends_at', ''),
  ('low_stock', '5'),
  ('unpaid_cancel_hours', '24'),
  ('line_oa_url', ''),
  ('policy_text', 'สินค้าทุกต้นแพ็คกันกระแทกก่อนส่ง หากต้นไม้เสียหายระหว่างขนส่ง ถ่ายรูปและวิดีโอตอนเปิดกล่องแล้วแจ้งร้านภายใน 24 ชั่วโมง ร้านจะส่งต้นใหม่หรือคืนเงินให้');

INSERT INTO categories (name, slug, sort_order) VALUES
  ('ไม้ผล', 'fruit-trees', 1),
  ('ไม้ดอก', 'flowers', 2),
  ('ไม้ประดับ', 'ornamental', 3),
  ('กล้าไม้', 'seedlings', 4),
  ('ดินและวัสดุปลูก', 'soil', 5),
  ('กระถางและอุปกรณ์', 'pots-tools', 6);
