import qrcode from 'qrcode-generator';

const tlv = (id: string, value: string) => id + value.length.toString().padStart(2, '0') + value;

function crc16(s: string) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * สร้างข้อความ QR พร้อมเพย์ (EMVCo) จากเบอร์มือถือ, เลขบัตรประชาชน/เลขผู้เสียภาษี หรือ e-Wallet ID
 * amountSatang ใส่เพื่อให้ลูกค้าไม่ต้องพิมพ์ยอดเอง
 */
export function promptPayPayload(id: string, amountSatang?: number) {
  const digits = id.replace(/\D/g, '');
  let target: string;
  if (digits.length === 10 && digits.startsWith('0')) {
    target = tlv('01', ('0066' + digits.slice(1)).padStart(13, '0'));
  } else if (digits.length === 13) {
    target = tlv('02', digits);
  } else if (digits.length === 15) {
    target = tlv('03', digits);
  } else {
    throw new Error('รูปแบบพร้อมเพย์ไม่ถูกต้อง ใช้เบอร์มือถือ 10 หลัก หรือเลข 13 หลัก');
  }
  const parts = [
    tlv('00', '01'),
    tlv('01', amountSatang ? '12' : '11'),
    tlv('29', tlv('00', 'A000000677010111') + target),
    tlv('53', '764'),
    ...(amountSatang ? [tlv('54', (amountSatang / 100).toFixed(2))] : []),
    tlv('58', 'TH'),
  ].join('');
  const body = parts + '6304';
  return body + crc16(body);
}

export function qrSvg(text: string, cellSize = 6) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}
