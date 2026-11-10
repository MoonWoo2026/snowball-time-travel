/* 自选股：当前时点报价、估值、持仓与加自选 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var S = null;
  var playTimer = null;

  function $(id) { return document.getElementById(id); }

  function addMonths(dateStr, months) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    return d.toISOString().slice(0, 10);
  }

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
    U.loadFail(e);
  });

  function render() {
    var grid = $('wlGrid');
    $('wlCount').textContent = S.watch.length + ' 只自选 · 时点 ' + S.date;
    $('wlDate').textContent = S.date;
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
      var band = v ? M.valueBand(code, S.date, 5, v.pb, v.peTtm) : null;
      var rank = verdict(band);

      return '<div class="wcard" data-code="' + code + '">' +
        '<div class="wc-top"><b>' + U.esc(st.name) + '</b><span>' + code + ' · ' + st.market + '</span>' +
        '<em class="wc-chg ' + U.cls(chg) + '">' + (chg === null ? '--' : U.pct(chg)) + '</em></div>' +
        '<div class="wc-price">' + (px === null ? '未上市' : U.px(px, st.currency)) +
        (px === null ? '' : '<small>' + (st.currency === 'HKD' ? '港元' : '人民币') + '</small>') + '</div>' +
        '<div class="wc-fund">' +
        '<div class="wf" title="PE(TTM) = 现价 ÷ 最近四个报告期每股收益之和"><span>PE(TTM)</span><b>' + fmtPe(v && v.peTtm) + '</b><em>' + bandTxt(band && band.pe) + '</em></div>' +
        '<div class="wf" title="PB = 现价 ÷ 最新每股净资产"><span>PB</span><b>' + U.num(v && v.pb, 2) + '</b><em>' + bandTxt(band && band.pb) + '</em></div>' +
        '<div class="wf" title="近 12 个月已派股息 ÷ 现价；ROE = 滚动每股收益 ÷ 每股净资产"><span>股息率</span><b>' + (v && v.divYield !== null && v.divYield !== undefined ? (v.divYield * 100).toFixed(2) + '%' : '--') + '</b>' +
        '<em>ROE ' + (v && v.roe !== null && v.roe !== undefined ? (v.roe * 100).toFixed(0) + '%' : '--') + '</em></div>' +
        '</div>' +
        (v ? '<div class="wc-mark">' +
          (rank ? '<span class="badge ' + rank.cls + '">' + rank.text + '</span>' : '<span class="badge none">估值分位不足</span>') +
          '<span class="grow" title="最新报告期同比（A 股单季 / 港股半年度）">' + growTxt(v.growth) + '</span>' +
          '</div>' : '') +
        (qty ? '<div class="wc-hold">' +
          '<span>持股<b>' + qty.toLocaleString('en-US') + '</b></span>' +
          '<span>市值<b>' + U.money(mv) + '</b></span>' +
          '<span>盈亏<b class="' + U.cls(pnl) + '">' + (pnl >= 0 ? '+' : '-') + U.money(Math.abs(pnl)) + '</b></span></div>' : '') +
        '<div class="wc-act">' +
        '<button data-trade="buy">买入</button>' +
        '<button data-trade="sell"' + (qty ? '' : ' disabled') + '>卖出</button>' +
        '<span class="lot">' + (st.market === 'A' ? '100股/手' : '1股起') + '</span>' +
        '<button class="rm" data-rm="' + code + '">移出</button>' +
        '</div></div>';
    }).join('');
  }

  /* PE(TTM)：亏损或缺失时的显示 */
  function fmtPe(v) {
    if (v === null || v === undefined || !isFinite(v) || v <= 0) return v === null || v === undefined ? '--' : '亏损';
    return v >= 100 ? v.toFixed(0) : v.toFixed(1);
  }

  function bandTxt(p) {
    if (p === null || p === undefined) return '分位 --';
    return '分位 ' + Math.round(p * 100) + '%';
  }

  /* 由 PB / PE 五年分位均值给出估值结论 */
  function verdict(band) {
    if (!band) return null;
    var arr = [band.pb, band.pe].filter(function (x) { return x !== null && x !== undefined; });
    if (!arr.length) return null;
    var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    if (avg <= 0.3) return { cls: 'low', text: '估值偏低' };
    if (avg >= 0.7) return { cls: 'high', text: '估值偏高' };
    return { cls: 'mid', text: '估值合理' };
  }

  function growTxt(g) {
    if (!g) return '';
    var bits = [];
    if (g.rev !== null && g.rev !== undefined) bits.push('营收 ' + U.pct(g.rev, 1));
    if (g.np !== null && g.np !== undefined) bits.push('归母 ' + U.pct(g.np, 1));
    return bits.length ? '最新期 ' + bits.join(' · ') : '';
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
    $('wlNext').addEventListener('click', function () { jumpTo(addMonths(S.date, 1)); });
    $('wlWaitGo').addEventListener('click', function () {
      var y = Math.max(0, Number($('wlWaitY').value) || 0);
      var mn = Math.max(0, Number($('wlWaitM').value) || 0);
      if (!y && !mn) return U.toast('请输入等待时长（年 / 月）');
      jumpTo(addMonths(S.date, y * 12 + mn));
    });
    $('wlPlay').addEventListener('click', function () {
      if (playTimer) { stopPlay(); return; }
      this.textContent = '⏸ 暂停';
      this.classList.add('on');
      playTimer = setInterval(function () {
        var cal = E.calendar();
        if (S.date >= cal[cal.length - 1]) { stopPlay(); U.toast('已滚动到最后一个交易日'); return; }
        jumpTo(addMonths(S.date, 1), true);
      }, 650);
    });

    document.querySelector('.wl-timebar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      var step = b.getAttribute('data-step');
      var cal = E.calendar();
      if (step === 'today') return jumpTo(cal[cal.length - 1]);
      var n = step === '3m' ? 3 : step === '6m' ? 6 : step === '1y' ? 12 : 36;
      jumpTo(addMonths(S.date, n));
    });

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

  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    var btn = $('wlPlay');
    btn.textContent = '▶ 连续滚动';
    btn.classList.remove('on');
  }

  /* 与终端共用同一份会话：推进后两端时点一致 */
  function jumpTo(date, quiet) {
    var cal = E.calendar();
    if (date <= S.date) {
      if (!quiet) U.toast('时间只能向前推进');
      return;
    }
    var before = S.divs.length;
    E.advanceTo(date);
    S = E.session();
    var gained = S.divs.length - before;
    if (!quiet) U.toast('推进至 ' + S.date + (gained ? ' · 结算 ' + gained + ' 笔分红' : ''));
    render();
    U.refreshHead();
  }
})();
