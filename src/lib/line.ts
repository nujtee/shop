import { Env } from './util';

/** ส่งข้อความเข้า LINE ของร้านผ่าน Messaging API (push) ถ้ายังไม่ตั้งค่า token จะข้ามไปเงียบ ๆ */
export async function notifyLine(env: Env, text: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_NOTIFY_TO) return;
  const targets = env.LINE_NOTIFY_TO.split(',').map((s) => s.trim()).filter(Boolean);
  for (const to of targets) {
    try {
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
        body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
      });
      if (!r.ok) console.error('LINE push failed', r.status, await r.text());
    } catch (e) {
      console.error('LINE push error', e);
    }
  }
}
