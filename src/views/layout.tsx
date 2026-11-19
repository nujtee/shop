import type { Child } from 'hono/jsx';
import { Settings } from '../lib/store';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap';

export const imgUrl = (key?: string | null) => (key ? `/media/${key}` : '');

export function Shell(props: { title: string; description?: string; image?: string; children: Child; bodyClass?: string; scripts?: string[] }) {
  return (
    <html lang="th">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{props.title}</title>
        {props.description && <meta name="description" content={props.description} />}
        <meta property="og:title" content={props.title} />
        {props.description && <meta property="og:description" content={props.description} />}
        {props.image && <meta property="og:image" content={props.image} />}
        <meta name="theme-color" content="#2f7d4f" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href="/styles.css?v=2" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body class={props.bodyClass}>
        {props.children}
        {(props.scripts ?? ['/app.js?v=1']).map((s) => (
          <script src={s} defer></script>
        ))}
      </body>
    </html>
  );
}

export function ShopHeader(props: { s: Settings; q?: string; back?: boolean }) {
  return (
    <header class="sbar">
      {props.back ? (
        <a class="icon-btn" href="/" aria-label="กลับหน้าร้าน">
          ‹
        </a>
      ) : (
        <a class="brand" href="/">
          {props.s.shop_name || 'Phasakura'}
        </a>
      )}
      <form class="search" action="/" method="get" role="search">
        <span aria-hidden="true">⌕</span>
        <input name="q" value={props.q ?? ''} placeholder="ค้นหาต้นไม้ ดิน กระถาง" aria-label="ค้นหาสินค้า" />
      </form>
      <a class="icon-btn" href="/cart" aria-label="ตะกร้าสินค้า">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" />
          <circle cx="9.5" cy="20" r="1.3" />
          <circle cx="17" cy="20" r="1.3" />
        </svg>
        <i data-cart-count hidden>
          0
        </i>
      </a>
    </header>
  );
}

export function ShopFooter(props: { s: Settings }) {
  return (
    <footer class="foot">
      <div>
        <b>{props.s.shop_name}</b> · {props.s.tagline}
      </div>
      <nav>
        <a href="/track">ติดตามคำสั่งซื้อ</a>
        <a href="/policy">การจัดส่งและการรับประกัน</a>
        {props.s.line_oa_url && (
          <a href={props.s.line_oa_url} target="_blank" rel="noopener">
            แชท LINE
          </a>
        )}
      </nav>
    </footer>
  );
}
