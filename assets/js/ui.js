/* 公共界面：头部、格式化、提示 */
window.SB = window.SB || {};
SB.ui = (function () {
  var ICON = {
    logo: '<img src="assets/img/logo.svg?v=20261201" alt="时光雪球" style="width:28px;height:28px;border-radius:6px">',
    lock: '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l3-4 3 3 5-6"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>',
    layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>'
  };

  var NAV = [
    { href: 'terminal.html', key: 'terminal', label: '交易终端' },
    { href: 'watchlist.html', key: 'watch', label: '自选股' },
    { href: 'review.html', key: 'review', label: '复盘报告' }
  ];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    return Number(v).toFixed(d === undefined ? 2 : d);
  }
  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    return '¥' + Math.round(v).toLocaleString('en-US');
  }
  function short(v) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    var a = Math.abs(v);
    if (a >= 1e8) return '¥' + (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return '¥' + (v / 1e4).toFixed(1) + '万';
    return '¥' + Math.round(v);
  }
  function pct(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    var s = (v * 100).toFixed(d === undefined ? 2 : d);
    if (Math.abs(Number(s)) < 1e-9) s = (0).toFixed(d === undefined ? 2 : d);
    return (Number(s) > 0 ? '+' : '') + s + '%';
  }
  function px(v, cur) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    var s = Number(v) >= 100 ? v.toFixed(2) : v.toFixed(3);
    return (cur === 'HKD' ? 'HK$' : '¥') + Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  /* 行情加载失败：给出明确原因 + 重试入口（移动端网络抖动很常见） */
  function loadFail(e) {
    var msg = (e && e.message) ? e.message : '未知错误';
    var old = document.getElementById('loadFail');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'loadFail';
    box.innerHTML =
      '<div class="lf-card">' +
        '<b>行情数据加载失败</b>' +
        '<p>' + esc(msg) + '</p>' +
        '<button type="button" id="lfRetry">重新加载</button>' +
      '</div>';
    document.body.appendChild(box);
    box.querySelector('#lfRetry').onclick = function () { location.reload(); };
  }

  function headMeta() {
    var S = SB.engine.session();
    if (!S) return '<a class="head-cta" href="setup.html">开始复盘</a>';
    var m = SB.engine.metrics();
    return '<div class="hm opt"><span>当前时点</span><b>' + esc(S.date) + '</b></div>' +
      '<div class="hm"><span>总资产</span><b class="accent">' + money(m.total) + '</b></div>' +
      '<div class="hm"><span>累计收益</span><b class="' + cls(m.ret) + '">' + pct(m.ret) + '</b></div>';
  }

  function header(active) {
    var el = document.getElementById('siteHead');
    if (!el) return;
    var nav = NAV.map(function (n) {
      return '<a href="' + n.href + '"' + (n.key === active ? ' class="on"' : '') + '>' + n.label + '</a>';
    }).join('');
    el.innerHTML = '<div class="head-in">' +
      '<a class="brand" href="index.html">' + ICON.logo +
      '<span><b>时光雪球</b><span>TIME TRAVEL · 历史复盘</span></span></a>' +
      '<nav class="nav">' + nav + '</nav>' +
      '<div class="head-meta" id="headMeta">' + headMeta() + '</div>' +
      '</div>';
  }

  function refreshHead() {
    var el = document.getElementById('headMeta');
    if (el) el.innerHTML = headMeta();
  }

  /* 加载数据 → 初始化引擎 → 恢复会话 → 画头部 */
  function boot(active) {
    return SB.market.load().then(function () {
      SB.engine.init();
      SB.engine.load();
      header(active);
      return SB.engine.session();
    });
  }

  function requireSession() {
    if (SB.engine.session()) return true;
    toast('还没有进行中的复盘，先创建一次');
    setTimeout(function () { location.href = 'setup.html'; }, 900);
    return false;
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }

  function csv(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v === null || v === undefined ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  /* ---------- 10 档推演存档 ---------- */
  function slotsDialog() {
    var mask = document.getElementById('slotMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'slotMask';
      mask.className = 'mask';
      mask.innerHTML = '<div class="dlg" role="dialog" aria-modal="true">' +
        '<div class="dlg-head"><div><b>推演存档</b><span>最多 10 档，保存在本机浏览器</span></div>' +
        '<button type="button" class="dlg-x" id="slotClose" aria-label="关闭">×</button></div>' +
        '<div class="dlg-body" id="slotList"></div>' +
        '<div class="dlg-foot"><span id="slotNow">--</span>' +
        '<button type="button" class="danger" id="slotReset">清空当前推演</button></div>' +
        '</div>';
      document.body.appendChild(mask);

      mask.addEventListener('click', function (e) {
        if (e.target === mask || e.target.closest('#slotClose')) return closeSlots();
        var row = e.target.closest('[data-slot]');
        if (!row) {
          if (e.target.closest('#slotReset')) resetSession();
          return;
        }
        var i = Number(row.getAttribute('data-slot'));
        var act = e.target.closest('[data-act]');
        if (!act) return;
        var kind = act.getAttribute('data-act');
        if (kind === 'save') {
          var r = SB.engine.saveSlot(i);
          if (!r.ok) return toast(r.msg);
          toast('已存入第 ' + (i + 1) + ' 档');
          renderSlots();
        } else if (kind === 'load') {
          if (!confirm('读取该存档会覆盖当前进度，未保存的推演将丢失。继续？')) return;
          var l = SB.engine.loadSlot(i);
          if (!l.ok) return toast(l.msg);
          location.href = 'terminal.html';
        } else if (kind === 'del') {
          if (!confirm('删除第 ' + (i + 1) + ' 档存档？')) return;
          SB.engine.dropSlot(i);
          toast('已删除第 ' + (i + 1) + ' 档');
          renderSlots();
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && mask.classList.contains('on')) closeSlots();
      });
    }
    renderSlots();
    mask.classList.add('on');
  }

  function closeSlots() {
    var mask = document.getElementById('slotMask');
    if (mask) mask.classList.remove('on');
  }

  function resetSession() {
    if (!SB.engine.session()) return toast('当前没有进行中的复盘');
    if (!confirm('清空当前推演并重新开始？已保存的存档不会受影响。')) return;
    SB.engine.reset();
    closeSlots();
    location.href = 'setup.html';
  }

  function renderSlots() {
    var list = document.getElementById('slotList');
    if (!list) return;
    var S = SB.engine.session();
    var items = SB.engine.slots();
    var n = 0;
    list.innerHTML = items.map(function (it, i) {
      if (!it) {
        return '<div class="slot" data-slot="' + i + '">' +
          '<span class="slot-no">' + pad(i + 1) + '</span>' +
          '<div class="slot-meta"><b>空档位</b><span>存入当前推演进度</span></div>' +
          '<div class="slot-ops"><button type="button" data-act="save"' + (S ? '' : ' disabled') + '>存入</button></div>' +
          '</div>';
      }
      n++;
      return '<div class="slot on" data-slot="' + i + '">' +
        '<span class="slot-no">' + pad(i + 1) + '</span>' +
        '<div class="slot-meta"><b>' + esc(it.startDate) + ' 起 · 至 ' + esc(it.date) + '</b>' +
        '<span>' + money(it.total) + ' · 累计 <em class="' + cls(it.ret) + '">' + pct(it.ret) + '</em>' +
        ' · 保存于 ' + esc(String(it.at || '').slice(0, 10)) + '</span></div>' +
        '<div class="slot-ops"><button type="button" data-act="load">读取</button>' +
        '<button type="button" class="danger" data-act="del">删除</button></div>' +
        '</div>';
    }).join('');

    var now = document.getElementById('slotNow');
    if (now) {
      now.textContent = S
        ? '当前推演 · ' + S.date + ' · 已用 ' + n + '/10 档'
        : '当前没有进行中的复盘 · 已用 ' + n + '/10 档';
    }
    var btn = document.getElementById('slotReset');
    if (btn) btn.disabled = !S;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  return {
    ICON: ICON, esc: esc, num: num, money: money, short: short, pct: pct, px: px, cls: cls,
    toast: toast, header: header, refreshHead: refreshHead, boot: boot, loadFail: loadFail,
    requireSession: requireSession, download: download, csv: csv, slotsDialog: slotsDialog
  };
})();
