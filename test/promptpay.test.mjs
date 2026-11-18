// ตรวจข้อความ QR พร้อมเพย์: โครงสร้าง TLV และ CRC16-CCITT ที่คำนวณแยกอิสระ
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: ['src/lib/promptpay.ts'], bundle: true, format: 'esm', write: false, platform: 'browser' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
function crc(s) { let c = 0xffff; for (const b of Buffer.from(s, 'latin1')) { for (let i = 0; i < 8; i++) { const bit = ((b >> (7 - i)) & 1) === 1; const c15 = ((c >> 15) & 1) === 1; c = (c << 1) & 0xffff; if (c15 !== bit) c ^= 0x1021; } } return c.toString(16).toUpperCase().padStart(4, '0'); }
const p = mod.promptPayPayload('081-234-5678', 53900);
assert.ok(p.includes('29370016A000000677010111011300668123456 78'.replace(' ', '')));
assert.ok(p.includes('5406539.00'));
assert.ok(p.includes('010212'));
assert.equal(p.slice(-4), crc(p.slice(0, -4)));
const n = mod.promptPayPayload('1234567890123');
assert.ok(n.includes('02131234567890123') && n.includes('010211') && !n.includes('54'));
assert.equal(n.slice(-4), crc(n.slice(0, -4)));
assert.throws(() => mod.promptPayPayload('12345'));
assert.ok(mod.qrSvg(p).startsWith('<svg'));
console.log('promptpay ok:', p);
