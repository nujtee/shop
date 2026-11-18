-- ข้อมูลตัวอย่างสำหรับทดสอบในเครื่องเท่านั้น (npm run db:demo) ห้ามใช้กับร้านจริง
INSERT INTO products (id, category_id, name, slug, description, badge, is_featured, sold_count) VALUES
 (1, 1, 'ต้นบลูเบอร์รี่ พันธุ์ F6 (Magica) ติดดอก ติดผลแล้ว ปลูกในไทยได้', 'blueberry-f6', 'สูง 60-70 ซม. ติดดอกติดผลแล้วทุกต้น เหมาะกับอากาศไทย', 'แนะนำ', 1, 1040),
 (2, 1, 'ต้นสตรอเบอร์รี่พันธุ์ 80 ชุด 10 ต้น', 'strawberry-80', 'ต้นแข็งแรง รากแน่น ผลใหญ่ หวานฉ่ำ', '', 0, 1200),
 (3, 2, 'ต้นซากุระดอยพญาเสือโคร่ง สูง 80 ซม.', 'sakura-80', 'ดอกชมพู ปลูกได้ในที่สูงอากาศเย็น', 'ขายดี', 1, 640),
 (4, 5, 'ดินปลูกสูตรผสมพร้อมใช้ 5 ลิตร', 'soil-5l', 'ดินร่วน ผสมขุยมะพร้าวและปุ๋ยคอก', '', 0, 320),
 (5, 6, 'กระถางพลาสติกทรงกลม 8 นิ้ว', 'pot-8in', 'สีดำ มีรูระบายน้ำ', '', 0, 85);
INSERT INTO variants (product_id, name, price, compare_at_price, stock, weight_g, sort_order) VALUES
 (1, 'สูง 40-50 ซม.', 39000, 59000, 12, 1500, 0),
 (1, 'สูง 60-70 ซม.', 53900, 91000, 38, 2500, 1),
 (1, 'สูง 1 ม. ติดผล', 89000, NULL, 0, 4000, 2),
 (2, 'ชุด 10 ต้น', 5500, 10000, 120, 800, 0),
 (3, 'มาตรฐาน', 25900, 39000, 3, 3000, 0),
 (4, '1 ถุง', 6500, NULL, 50, 2500, 0),
 (4, '3 ถุง', 18000, 19500, 20, 7500, 1),
 (5, '1 ใบ', 2500, NULL, 200, 300, 0);
INSERT INTO coupons (code, type, value, min_spend, max_discount) VALUES ('SAKURA10', 'percent', 10, 0, 5000);
UPDATE settings SET value = '0812345678' WHERE key = 'promptpay_id';
UPDATE settings SET value = 'ร้านผาซากุระ' WHERE key = 'promptpay_name';
UPDATE settings SET value = 'ใช้โค้ด SAKURA10 ลด 10% ไม่มีขั้นต่ำ' WHERE key = 'promo_text';
UPDATE settings SET value = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day') WHERE key = 'promo_ends_at';
UPDATE settings SET value = '99900' WHERE key = 'free_shipping_min';
