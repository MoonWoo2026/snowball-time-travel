/* 自选股：当前时点报价、估值、持仓与加自选 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var S = null;

  function $(id) { return document.getElementById(id); }

  SB.market.load().then(function () {
    E.init();
    S = E.load();
    U.header('watch');
    if (!S) {
      $('wlGrid').innerHTML = '<div class="empty" style="grid-column:1/-1">还没有进行中的复盘。' +
        '<a href="setup.html">先创建一次复盘 →</a></div>';
      $('wlCount').textContent = '0 只';
      return;
    }
    render();
    bind();
  }).catch(function (e) {
    U.toast('数据加载失败：' + e.message);
  });

  function render() {
    var grid = $('wlGrid');
    $('wlCount').textContent = S.watch.length + ' 只自选 · 时点 ' + S.date;
    var m = E.metrics();
    $('wlNote').textContent = '总资产 ' + U.money(m.total) + ' · 可用现金 ' + U.money(m.cash);

    if (!S.watch.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">自选股为空，搜索加入一只标的。</div>';
      return;
    }
    grid.innerHTML = S.watch.map(function (code) {
      var st = M.stock(code);
      if (!st) return '';
      var r = M.barAt(code, S.date);
      var v = M.valuation(code, S.date);
      var px = r ? r.close : null;
      var prev = r && r.idx > 0 ? st.bars[r.idx - 1][4] : null;
      var chg = px !== null && prev ? px / prev - 1 : null;
      var qty = E.shares(code);
      var cost = E.position(code) ? E.position(code).cost : 0;
      var mv = px === null ? 0 : qty * px * M.toCNY(1, st.currency, S.date);
      var pnl = mv - cost;

      return '<div class="wcard" data-code="' + code + '">' +
        '<div class="wc-top"><b>' + U.esc(st.name) + '</b><span>' + code + ' · ' + st.market + '</span>' +
        '<em class="wc-chg ' + U.cls(chg) + '">' + (chg === null ? '--' : U.pct(chg)) + '</em></div>' +
        '<div class="wc-price">' + (px === null ? '未上市' : U.px(px, st.currency)) +
        (px === null ? '' : '<small>' + (st.currency === 'HKD' ? '港元' : '人民币') + '</small>') + '</div>' +
        '<div class="wc-stat">' +
        '<span>PB</span><b>' + (v && v.pb ? v.pb.toFixed(2) : '--') + '</b>' +
        '<span>PE</span><b>' + (v && v.pe ? v.pe.toFixed(1) : '--') + '</b>' +
        '<span>股息</span><b>' + (v && v.divYield ? (v.divYield * 100).toFixed(2) + '%' : '--') + '</b>' +
        '<span>持仓</span><b>' + (qty ? qty.toLocaleString('en-US') : '--') + '</b>' +
        '</div>' +
        (qty ? '<div class="wc-stat" style="border-top:1px dashed var(--rule2);margin-top:6px"><span>市值</span><b>' + U.money(mv) + '</b>' +
          '<span>盈亏</span><b class="' + U.cls(pnl) + '">' + (pnl >= 0 ? '+' : '-') + U.money(Math.abs(pnl)) + '</b></div>' : '') +
        '<div class="wc-act">' +
        '<button data-trade="buy">买入</button>' +
        '<button data-trade="sell"' + (qty ? '' : ' disabled') + '>卖出</button>' +
        '<span class="lot">' + (st.market === 'A' ? '100股/手' : '1股起') + '</span>' +
        '<button class="rm" data-rm="' + code + '">移出</button>' +
        '</div></div>';
    }).join('');
  }

  function addPool(kw) {
    var has = {};
    S.watch.forEach(function (c) { has[c] = 1; });
    return M.meta().stocks.filter(function (s) {
      if (has[s.code]) return false;
      if (!kw) return true;
      return s.code.indexOf(kw) >= 0 || s.name.indexOf(kw) >= 0 || (s.sector || '').indexOf(kw) >= 0;
    }).slice(0, 10);
  }

  function showResults(kw) {
    var box = $('addResults');
    var list = addPool(kw);
    if (!list.length) {
      box.innerHTML = '<div class="pick-row">没有可加入的标的</div>';
    } else {
      box.innerHTML = list.map(function (s) {
        return '<div class="pick-row" data-add="' + s.code + '"><b>' + U.esc(s.name) + '</b>' +
          '<span>' + s.code + ' · ' + s.market + ' · ' + U.esc(s.sector || '') + '</span><em>加入</em></div>';
      }).join('');
    }
    box.classList.remove('hide');
  }

  function bind() {
    $('addSearch').addEventListener('input', function () { showResults(this.value.trim()); });
    $('addSearch').addEventListener('focus', function () { showResults(this.value.trim()); });
    $('addResults').addEventListener('mousedown', function (e) {
      var row = e.target.closest('[data-add]');
      if (!row) return;
      e.preventDefault();
      var code = row.getAttribute('data-add');
      E.addWatch(code);
      S = E.session();
      $('addSearch').value = '';
      $('addResults').classList.add('hide');
      U.toast('已加入自选：' + M.stock(code).name);
      render();
      U.refreshHead();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.wl-search')) $('addResults').classList.add('hide');
    });

    $('wlGrid').addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]');
      if (rm) {
        e.stopPropagation();
        var code = rm.getAttribute('data-rm');
        var r = E.removeWatch(code);
        if (!r.ok) return U.toast(r.msg);
        S = E.session();
        render();
        U.refreshHead();
        return;
      }
      var trade = e.target.closest('[data-trade]');
      if (trade) {
        var card = trade.closest('.wcard');
        location.href = 'terminal.html?code=' + card.getAttribute('data-code');
        return;
      }
      var card2 = e.target.closest('.wcard');
      if (card2) location.href = 'terminal.html?code=' + card2.getAttribute('data-code');
    });
  }
})();
