(function () {
  'use strict';
  // ยืนยันก่อนทำรายการที่ย้อนไม่ได้
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // เพิ่มแถวตัวเลือกสินค้า
  var addBtn = document.querySelector('[data-add-variant]');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var body = document.querySelector('[data-variants] tbody');
      var row = body.rows[body.rows.length - 1].cloneNode(true);
      row.querySelectorAll('input').forEach(function (i) { i.value = i.name === 'v_weight' ? '500' : i.name === 'v_stock' ? '0' : ''; });
      row.querySelector('select').value = '1';
      body.appendChild(row);
      row.querySelector('input[name=v_name]').focus();
    });
  }

  // ย่อรูปก่อนอัปโหลด (ด้านยาวไม่เกิน 1600px)
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !file.type.startsWith('image/')) return resolve(file);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b ? new File([b], 'photo.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  var up = document.querySelector('[data-image-upload]');
  if (up) {
    up.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = up.querySelector('input[type=file]');
      var status = up.querySelector('[data-upload-status]');
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      status.textContent = 'กำลังย่อและอัปโหลด ' + files.length + ' รูป…';
      up.querySelector('button').disabled = true;
      Promise.all(files.map(shrink)).then(function (out) {
        var fd = new FormData();
        out.forEach(function (f) { fd.append('images', f); });
        return fetch(up.action, { method: 'POST', body: fd, headers: { accept: 'application/json' } });
      }).then(function (r) {
        if (!r.ok) throw new Error();
        location.href = location.pathname + '?m=uploaded';
      }).catch(function () {
        status.textContent = 'อัปโหลดไม่สำเร็จ ลองอีกครั้ง';
        up.querySelector('button').disabled = false;
      });
    });
  }
})();

// หน้า ธีมสี: แสดงตัวอย่างทันทีเมื่อเลือกสี
(function () {
  var form = document.querySelector('.theme-form');
  var prev = document.querySelector('[data-theme-preview]');
  if (!form || !prev) return;
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function hex(c) { return '#' + c.map(function (x) { return Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0'); }).join(''); }
  function lum(h) {
    var v = rgb(h).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function readable(c) {
    var out = c, a = rgb(c);
    for (var t = 0.1; contrast(out, '#ffffff') < 3 && t <= 1; t += 0.1) out = hex(a.map(function (x) { return x * (1 - t); }));
    return out;
  }
  function on(c) { return contrast(c, '#ffffff') >= 3 ? '#ffffff' : '#1d221c'; }
  form.addEventListener('change', function (e) {
    var el = e.target;
    if (el.type !== 'radio') return;
    var c = readable(el.value);
    prev.style.setProperty('--' + (el.name === 'accent' ? 'accent' : 'leaf'), c);
    prev.style.setProperty('--on-' + (el.name === 'accent' ? 'accent' : 'leaf'), on(c));
    var dot = document.querySelector('[data-now="' + el.name + '"]');
    var txt = document.querySelector('[data-now-hex="' + el.name + '"]');
    if (dot) dot.style.setProperty('--c', el.value);
    if (txt) txt.textContent = el.value;
  });
})();
