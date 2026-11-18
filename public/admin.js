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
