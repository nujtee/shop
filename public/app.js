(function () {
  'use strict';
  var KEY = 'ps_cart_v1';
  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    badge();
  }
  function add(variantId, qty) {
    var items = read();
    var hit = items.find(function (i) { return i.variant_id === variantId; });
    if (hit) hit.qty += qty; else items.push({ variant_id: variantId, qty: qty });
    write(items);
  }
  function badge() {
    var n = read().reduce(function (a, i) { return a + i.qty; }, 0);
    document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = n > 99 ? '99+' : String(n); el.hidden = n === 0; });
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:10px 18px;border-radius:999px;z-index:50;font-size:14px';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  // นับถอยหลัง
  function pad(n) { return String(n).padStart(2, '0'); }
  function tick() {
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var s = Math.max(0, Math.floor((new Date(el.getAttribute('data-countdown')) - Date.now()) / 1000));
      var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      var hh = pad(h + (d && el.hasAttribute('data-plain') ? 0 : d * 24));
      if (el.hasAttribute('data-plain')) el.textContent = (d ? d + ' วัน ' : '') + pad(h) + ':' + pad(m) + ':' + pad(x);
      else el.innerHTML = '<span>' + hh + '</span>:<span>' + pad(m) + '</span>:<span>' + pad(x) + '</span>';
    });
  }
  if (document.querySelector('[data-countdown]')) { tick(); setInterval(tick, 1000); }

  // หน้าสินค้า
  var buy = document.querySelector('[data-buy]');
  if (buy) {
    var qty = buy.querySelector('input[name=qty]');
    var current = function () { return buy.querySelector('input[name=variant]:checked') || buy.querySelector('input[type=hidden][name=variant]'); };
    var stockOf = function () { var v = current(); return v ? parseInt(v.getAttribute('data-stock') || '0', 10) : 0; };
    var sync = function () {
      var v = current(); if (!v) return;
      var st = stockOf();
      if (v.getAttribute('data-price')) {
        var p = document.querySelector('[data-price]'); if (p && p.tagName === 'SPAN') p.textContent = v.getAttribute('data-price');
        var c = document.querySelector('s[data-compare]'); if (c) { c.textContent = v.getAttribute('data-compare'); c.hidden = !v.getAttribute('data-compare'); }
        var pc = document.querySelector('[data-pct]'); if (pc && pc.tagName === 'SPAN') { pc.textContent = v.getAttribute('data-pct'); pc.hidden = !v.getAttribute('data-pct'); }
      }
      var lab = document.querySelector('[data-stock-label]'); if (lab) lab.textContent = st > 0 ? 'เหลือ ' + st + ' ชิ้น' : 'สินค้าหมด';
      if (parseInt(qty.value, 10) > st) qty.value = Math.max(1, st);
      buy.querySelectorAll('button[type=submit]').forEach(function (b) { b.disabled = st <= 0; });
    };
    buy.addEventListener('change', sync);
    buy.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = (parseInt(qty.value, 10) || 1) + parseInt(b.getAttribute('data-step'), 10);
        qty.value = Math.min(Math.max(1, n), Math.max(1, stockOf()));
      });
    });
    buy.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = current(); if (!v) return;
      var n = Math.max(1, parseInt(qty.value, 10) || 1);
      add(parseInt(v.value, 10), n);
      if (e.submitter && e.submitter.value === 'buy') location.href = '/cart';
      else toast('ใส่ตะกร้าแล้ว');
    });
  }

  // ตะกร้าและชำระเงิน
  var cartApp = document.getElementById('cart-app');
  if (cartApp) {
    var linesEl = cartApp.querySelector('[data-lines]');
    var form = document.getElementById('checkout');
    var sumEl = cartApp.querySelector('[data-sum]');
    var errEl = cartApp.querySelector('[data-err]');
    var couponMsg = cartApp.querySelector('[data-coupon-msg]');
    var coupon = '';
    var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
    var payMethod = function () { var r = form.querySelector('input[name=payment_method]:checked'); return r ? r.value : 'promptpay'; };
    try { var saved = JSON.parse(localStorage.getItem('ps_addr') || 'null'); if (saved) Object.keys(saved).forEach(function (k) { var i = form.elements[k]; if (i && !i.value) i.value = saved[k]; }); } catch (e) {}

    var render = function (q) {
      var items = read();
      if (!q.lines.length) {
        linesEl.innerHTML = '<p class="empty">ตะกร้ายังว่าง <a href="/">เลือกสินค้า</a></p>';
        form.hidden = true;
        if (items.length) write([]);
        return;
      }
      // ตัดรายการที่ไม่ขายแล้วออกจากตะกร้า
      var keep = q.lines.map(function (l) { return l.variant_id; });
      if (items.some(function (i) { return keep.indexOf(i.variant_id) < 0; })) write(items.filter(function (i) { return keep.indexOf(i.variant_id) >= 0; }));
      linesEl.innerHTML = q.lines.map(function (l) {
        return '<div class="ci"><a class="th" href="/p/' + encodeURIComponent(l.product_slug) + '">' +
          (l.image ? '<img src="' + esc(l.image) + '" alt="">' : '🌱') + '</a>' +
          '<div><div class="ttl">' + esc(l.product_name) + '</div><div class="muted">' + esc(l.variant_name) + ' · ' + esc(l.price_text) + '</div>' +
          (l.stock < l.qty ? '<div class="neg">เหลือ ' + l.stock + ' ชิ้น</div>' : '') + '</div>' +
          '<div class="ci-side"><div class="num">' + esc(l.line_total_text) + '</div><div class="qty">' +
          '<button type="button" data-dq="' + l.variant_id + '" aria-label="ลดจำนวน">−</button><span class="num" style="min-width:26px;text-align:center">' + l.qty + '</span>' +
          '<button type="button" data-iq="' + l.variant_id + '" aria-label="เพิ่มจำนวน"' + (l.qty >= l.stock ? ' disabled' : '') + '>+</button></div></div></div>';
      }).join('');
      form.hidden = false;
      var rows = [['ค่าสินค้า', q.subtotal]];
      if (q.discount) rows.push(['ส่วนลด ' + (q.coupon || ''), '−' + q.discount]);
      rows.push(['ค่าส่ง (' + q.weight_kg + ' กก.)', q.shipping_fee]);
      if (q.cod_fee) rows.push(['ค่าบริการเก็บเงินปลายทาง', q.cod_fee]);
      sumEl.innerHTML = rows.map(function (r) { return '<div><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>'; }).join('') +
        (q.free_shipping_hint ? '<div class="hint">' + esc(q.free_shipping_hint) + '</div>' : '') +
        '<div class="tot"><span>รวม</span><span>' + esc(q.total) + '</span></div>';
      if (coupon) { couponMsg.hidden = false; couponMsg.className = q.coupon_error ? 'err' : 'ok'; couponMsg.textContent = q.coupon_error || ('ใช้โค้ด ' + q.coupon + ' แล้ว'); }
      else couponMsg.hidden = true;
      errEl.hidden = !q.errors.length; errEl.textContent = q.errors.join(' · ');
    };
    var refresh = function () {
      return fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: read(), coupon: coupon, payment_method: payMethod() }) })
        .then(function (r) { return r.json(); }).then(render)
        .catch(function () { linesEl.innerHTML = '<p class="err">โหลดตะกร้าไม่สำเร็จ ลองรีเฟรชหน้า</p>'; });
    };
    linesEl.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var id = parseInt(b.getAttribute('data-iq') || b.getAttribute('data-dq'), 10);
      var items = read(), it = items.find(function (i) { return i.variant_id === id; }); if (!it) return;
      it.qty += b.hasAttribute('data-iq') ? 1 : -1;
      write(items.filter(function (i) { return i.qty > 0; }));
      refresh();
    });
    cartApp.querySelector('[data-apply-coupon]').addEventListener('click', function () { coupon = form.elements.coupon.value.trim(); refresh(); });
    form.addEventListener('change', function (e) { if (e.target.name === 'payment_method') refresh(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[data-submit]');
      var data = {};
      ['customer_name', 'phone', 'address_line', 'subdistrict', 'district', 'province', 'postcode', 'note'].forEach(function (k) { data[k] = form.elements[k].value; });
      try { var a = Object.assign({}, data); delete a.note; localStorage.setItem('ps_addr', JSON.stringify(a)); } catch (e2) {}
      data.items = read(); data.coupon = coupon || form.elements.coupon.value.trim(); data.payment_method = payMethod();
      btn.disabled = true; btn.textContent = 'กำลังสั่งซื้อ…'; errEl.hidden = true;
      fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j.url) { write([]); location.href = res.j.url; return; }
          errEl.hidden = false; errEl.textContent = res.j.error || 'สั่งซื้อไม่สำเร็จ';
          btn.disabled = false; btn.textContent = 'สั่งซื้อ'; refresh();
        })
        .catch(function () { errEl.hidden = false; errEl.textContent = 'เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง'; btn.disabled = false; btn.textContent = 'สั่งซื้อ'; });
    });
    refresh();
  }

  badge();
})();
