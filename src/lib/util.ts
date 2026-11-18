export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SHOP_URL: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_NOTIFY_TO?: string;
};

/** สตางค์ -> "฿1,234.00" */
export const baht = (satang: number) =>
  '฿' + (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,234.5" -> 123450 สตางค์; ค่าว่างหรือไม่ใช่ตัวเลขคืน null */
export const toSatang = (v: unknown): number | null => {
  const s = String(v ?? '').replace(/[,฿\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export const toInt = (v: unknown, fallback = 0) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

/** ทำ slug ที่เก็บตัวอักษรไทยไว้ได้ */
export const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

export const randomToken = (bytes = 16) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const orderNo = () => {
  const d = new Date(Date.now() + 7 * 3600_000); // เวลาไทย
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return `PS${ymd}${[...a].map((b) => ALPHA[b % ALPHA.length]).join('')}`;
};

/** แสดงเวลาเป็นเวลาไทย */
export const thaiTime = (iso?: string | null) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** ค่าจากช่อง datetime-local (เวลาไทย) -> ISO UTC */
export const localToIso = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s.length === 16 ? `${s}:00+07:00` : `${s}+07:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/** ISO UTC -> ค่าสำหรับช่อง datetime-local (เวลาไทย) */
export const isoToLocal = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return d.toISOString().slice(0, 16);
};

export const nowIso = () => new Date().toISOString();

export const formatSold = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);

export const ORDER_STATUS: Record<string, string> = {
  awaiting_payment: 'รอชำระเงิน',
  to_pack: 'รอแพ็ค',
  packing: 'กำลังแพ็ค',
  shipped: 'ส่งแล้ว',
  delivered: 'ได้รับแล้ว',
  cancelled: 'ยกเลิก',
};

export const PAYMENT_STATUS: Record<string, string> = {
  awaiting: 'รอโอน',
  slip_uploaded: 'แนบสลิปแล้ว รอตรวจ',
  paid: 'ชำระแล้ว',
  cod: 'เก็บเงินปลายทาง',
  refunded: 'คืนเงินแล้ว',
};

export const PAYMENT_METHOD: Record<string, string> = {
  promptpay: 'พร้อมเพย์',
  cod: 'เก็บเงินปลายทาง',
};
