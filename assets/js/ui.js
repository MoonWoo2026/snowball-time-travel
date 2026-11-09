/* 公共界面：头部、格式化、提示 */
window.SB = window.SB || {};
SB.ui = (function () {
  var ICON = {
    logo: '<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 8-9"/><path d="M3 21h18"/><circle cx="18" cy="5" r="1.6"/></svg>',
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
      '<span><b>滚雪球</b><span>TIME TRAVEL · 历史复盘</span></span></a>' +
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

  return {
    ICON: ICON, esc: esc, num: num, money: money, short: short, pct: pct, px: px, cls: cls,
    toast: toast, header: header, refreshHead: refreshHead, boot: boot,
    requireSession: requireSession, download: download, csv: csv
  };
})();
