// ธีมสีของเว็บ: เก็บใน settings คีย์ theme_accent (สีหลัก: ราคา ปุ่ม) และ theme_leaf (สีรอง: ชื่อร้าน ลิงก์)
export const DEFAULT_ACCENT = '#e5466b';
export const DEFAULT_LEAF = '#2f7d4f';

export const PRESETS: { key: string; name: string; leaf: string; accent: string }[] = [
  { key: 'sakura', name: 'ผาซากุระ', leaf: '#2f7d4f', accent: '#e5466b' },
  { key: 'orange', name: 'ส้มอบอุ่น', leaf: '#9a4a12', accent: '#ee4d2d' },
  { key: 'ocean', name: 'ฟ้าทะเล', leaf: '#1f5f8b', accent: '#0e86d4' },
  { key: 'lavender', name: 'ม่วงลาเวนเดอร์', leaf: '#5b3f8c', accent: '#9b51e0' },
  { key: 'terracotta', name: 'ดินเผา', leaf: '#7a4b2a', accent: '#c4622d' },
  { key: 'mint', name: 'เขียวมิ้นต์', leaf: '#0f766e', accent: '#14b8a6' },
  { key: 'gold', name: 'ดำทอง', leaf: '#1f2937', accent: '#b8860b' },
];

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

type RGB = [number, number, number];
const toRgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

function hsl(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

// จานสี 256 สี: แถวแรกเทา 16 ระดับ ต่อด้วย 15 เฉดสี × 16 ระดับความเข้ม
export const PALETTE: string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < 16; i++) out.push(toHex([i * 17, i * 17, i * 17]));
  for (let h = 0; h < 15; h++) for (let j = 0; j < 16; j++) out.push(hsl(h * 24, 78, 92 - j * 5.2));
  return out;
})();

function lum(h: string): number {
  const [r, g, b] = toRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a), y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
};

// ปรับสีให้อ่านออกบนพื้นหลัง (ตัวหนังสือ/ปุ่มต้องตัดกับพื้นอย่างน้อย 3:1)
function readable(color: string, surface: string, toward: string): string {
  let c = color;
  for (let t = 0.1; contrast(c, surface) < 3 && t <= 1; t += 0.1) c = mix(color, toward, t);
  return c;
}
const onColor = (bg: string) => (contrast(bg, '#ffffff') >= 3 ? '#ffffff' : '#1d221c');

export function themeVars(accentIn?: string, leafIn?: string) {
  const accent = isHex(accentIn) ? accentIn.toLowerCase() : DEFAULT_ACCENT;
  const leaf = isHex(leafIn) ? leafIn.toLowerCase() : DEFAULT_LEAF;
  const light = { accent: readable(accent, '#ffffff', '#000000'), leaf: readable(leaf, '#ffffff', '#000000') };
  const dark = { accent: readable(accent, '#1c201b', '#ffffff'), leaf: readable(leaf, '#1c201b', '#ffffff') };
  const block = (v: { accent: string; leaf: string }) =>
    `--accent:${v.accent};--leaf:${v.leaf};--on-accent:${onColor(v.accent)};--on-leaf:${onColor(v.leaf)};`;
  return {
    accent,
    leaf,
    light,
    lightOn: { accent: onColor(light.accent), leaf: onColor(light.leaf) },
    css:
      `:root{${block(light)}}` +
      `@media (prefers-color-scheme:dark){:root{${block(dark)}}}`,
  };
}

export const isDefaultTheme = (a?: string, l?: string) =>
  (!isHex(a) || a.toLowerCase() === DEFAULT_ACCENT) && (!isHex(l) || l.toLowerCase() === DEFAULT_LEAF);
