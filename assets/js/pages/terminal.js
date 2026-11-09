/* 交易终端：时间推进、K 线、估值、持仓与下单 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var C = {
    up: '#C0453B', down: '#2E7D5B', ink: '#1C2126', muted: '#6A7280', faint: '#9AA0A8',
    rule: '#EFEBE2', accent: '#1E3A5F', gold: '#B07A2E', panel: '#FFFFFF'
  };
  var LIMIT = { day: 800, week: 400, month: 240, quarter: 120, year: 80 };
  var S = null;
  var state = { code: null, period: 'day', mode: 'qfq', tab: 'pos' };
  var chart, growth, curve;

  function $(id) { return document.getElementById(id); }
  function lot(code) { return M.stock(code).market === 'A' ? 100 : 1; }
  function cur(code) { return M.stock(code).currency; }
  function priceOf(code) { return M.priceAt(code, S.date); }
  function cny(code, amount) { return M.toCNY(amount, cur(code), S.date); }

  SB.market.load().then(function () {
    E.init();
    S = E.load();
    if (!S) { U.requireSession(); return; }
    U.header('terminal');

    var q = new URLSearchParams(location.search).get('code');
    if (q && M.stock(q)) {
      if (S.watch.indexOf(q) < 0) E.addWatch(q);
      state.code = q;
    } else {
      var listed = S.watch.filter(function (c) { return M.listed(c, S.date); });
      state.code = listed[0] || S.watch[0] || M.meta().stocks[0].code;
    }
    if (!S.watch.length) E.addWatch(state.code);

    $('drip').checked = !!S.drip;
    chart = echarts.init($('chart'));
    growth = echarts.init($('growth'));
    curve = echarts.init($('curve'));
    bind();
    renderAll();
    window.addEventListener('resize', function () {
      chart.resize(); growth.resize(); curve.resize();
    });
  }).catch(function (e) {
    U.toast('数据加载失败：' + e.message);
  });

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderAcct();
    renderSelect();
    renderTime();
    renderChart();
    renderValuation();
    renderGrowth();
    renderReports();
    renderCurve();
    renderLedger();
    renderDock();
    U.refreshHead();
    if (SB.cycle) SB.cycle.sync();
  }

  function renderAcct() {
    var m = E.metrics();
    $('aTotal').textContent = U.money(m.total);
    $('aCash').textContent = U.money(m.cash);
    $('aMv').textContent = U.money(m.mv);
    var ret = $('aRet');
    ret.textContent = U.pct(m.ret);
    ret.className = U.cls(m.ret);
    var cagr = $('aCagr');
    cagr.textContent = m.cagr === null ? '--' : U.pct(m.cagr);
    cagr.className = U.cls(m.cagr || 0);
    $('aDiv').textContent = U.money(m.div);
  }

  function renderSelect() {
    var sel = $('stockSel');
    sel.innerHTML = S.watch.map(function (code) {
      var st = M.stock(code);
      return '<option value="' + code + '"' + (code === state.code ? ' selected' : '') + '>' +
        U.esc(st.name) + ' · ' + code + (M.listed(code, S.date) ? '' : ' · 未上市') + '</option>';
    }).join('');
  }

  function renderTime() {
    var cal = E.calendar();
    var idx = cal.indexOf(S.date);
    $('tbDate').textContent = S.date;
    $('tbStart').textContent = S.startDate;
    $('tbEnd').textContent = cal[cal.length - 1];
    var r = $('tbRange');
    r.min = cal.indexOf(S.startDate);
    r.max = cal.length - 1;
    r.value = idx;
    $('tbJump').max = cal[cal.length - 1];
    $('tbJump').min = S.startDate;
  }

  function renderChart() {
    var code = state.code, st = M.stock(code);
    var all = M.viewBars(code, state.period, state.mode, S.date);
    var label = { day: '日K', week: '周K', month: '月K', quarter: '季K', year: '年K' }[state.period];
    $('cTitle').textContent = st.name + ' · ' + label + (state.mode === 'qfq' ? ' 前复权' : ' 不复权');
    $('cSub').textContent = code + ' · ' + st.market + ' 股 · ' + (st.currency === 'HKD' ? '港元' : '人民币') +
      ' · 数据封印至 ' + S.date;
    $('chipBars').textContent = all.length + ' 根';

    if (!all.length) {
      chart.clear();
      chart.setOption({
        title: {
          text: st.name + ' 在 ' + S.date + ' 尚未上市',
          left: 'center', top: 'middle',
          textStyle: { fontSize: 12, color: C.faint, fontWeight: 400 }
        }
      });
      return;
    }

    var startPos = Math.max(0, all.length - LIMIT[state.period]);
    var bars = all.slice(startPos);
    var anchor = all[all.length - 1].endIdx;
    var keys = bars.map(function (b) { return b.key; });
    var closes = bars.map(function (b) { return +b.close.toFixed(3); });
    var ohlc = bars.map(function (b) {
      return [+b.open.toFixed(3), +b.close.toFixed(3), +b.low.toFixed(3), +b.high.toFixed(3)];
    });
    var vols = bars.map(function (b, i) {
      return { value: b.volume, itemStyle: { color: b.close >= b.open ? C.up : C.down, opacity: .55 } };
    });
    var boll = M.boll(closes, 20, 2);
    var rsi = M.rsi(closes, 14);

    var marks = [];
    S.trades.forEach(function (t) {
      if (t.code !== code) return;
      var r = M.barAt(code, t.date);
      if (!r) return;
      var bi = -1;
      for (var i = 0; i < all.length; i++) {
        if (r.idx >= all[i].startIdx && r.idx <= all[i].endIdx) { bi = i; break; }
      }
      if (bi < startPos) return;
      var fac = state.mode === 'qfq' ? M.adjFactor(code, r.idx, anchor) : 1;
      marks.push({
        name: t.side === 'buy' ? 'B' : 'S',
        coord: [bi - startPos, +(t.price * fac).toFixed(3)],
        value: t.side === 'buy' ? 'B' : 'S',
        itemStyle: { color: t.side === 'buy' ? C.up : C.down },
        label: { color: '#fff', fontSize: 9, fontWeight: 700, formatter: t.side === 'buy' ? 'B' : 'S' }
      });
    });

    var show = Math.min(bars.length, 160);
    var dzStart = bars.length > show ? (1 - show / bars.length) * 100 : 0;

    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { fontSize: 9 } },
        backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: C.ink, fontSize: 11 },
        formatter: function (ps) {
          var b = bars[ps[0].dataIndex];
          if (!b) return '';
          var pc = b.close >= b.open ? C.up : C.down;
          return '<b>' + b.key + '</b><br>' +
            '开 ' + b.open.toFixed(2) + '　高 ' + b.high.toFixed(2) + '<br>' +
            '低 ' + b.low.toFixed(2) + '　收 <span style="color:' + pc + '">' + b.close.toFixed(2) + '</span><br>' +
            '量 ' + (b.volume / 1e4).toFixed(1) + '万';
        }
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 50, right: 14, top: 14, height: '46%' },
        { left: 50, right: 14, top: '64%', height: '10%' },
        { left: 50, right: 14, top: '79%', height: '14%' }
      ],
      xAxis: [
        { type: 'category', data: keys, gridIndex: 0, boundaryGap: true, axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        { type: 'category', data: keys, gridIndex: 1, boundaryGap: true, axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        { type: 'category', data: keys, gridIndex: 2, boundaryGap: true, axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint, hideOverlap: true }, splitLine: { show: false } }
      ],
      yAxis: [
        { scale: true, gridIndex: 0, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } },
        { gridIndex: 1, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        { gridIndex: 2, min: 0, max: 100, interval: 50, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1, 2], start: dzStart, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1, 2], start: dzStart, end: 100, height: 14, bottom: 0, borderColor: C.rule, fillerColor: 'rgba(30,58,95,.08)', handleStyle: { color: C.accent }, textStyle: { fontSize: 8, color: C.faint } }
      ],
      series: [
        {
          name: 'K线', type: 'candlestick', data: ohlc,
          itemStyle: {
            color: C.up, color0: C.down, borderColor: C.up, borderColor0: C.down
          },
          markPoint: { symbol: 'circle', symbolSize: 17, data: marks, label: { show: true } }
        },
        { name: 'BOLL·中', type: 'line', data: boll.mb, symbol: 'none', smooth: true, lineStyle: { width: 1, color: C.gold, opacity: .65 }, z: 2 },
        { name: 'BOLL·上', type: 'line', data: boll.up, symbol: 'none', smooth: true, lineStyle: { width: 1, color: C.accent, opacity: .28 }, z: 2 },
        { name: 'BOLL·下', type: 'line', data: boll.dn, symbol: 'none', smooth: true, lineStyle: { width: 1, color: C.accent, opacity: .28 }, z: 2 },
        { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: '60%' },
        {
          name: 'RSI', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: rsi,
          symbol: 'none', lineStyle: { width: 1.2, color: C.accent },
          markLine: {
            silent: true, symbol: 'none', label: { show: false },
            lineStyle: { color: C.faint, type: 'dashed', width: 1 },
            data: [{ yAxis: 70 }, { yAxis: 30 }]
          }
        }
      ]
    }, true);
  }

  function renderValuation() {
    var v = M.valuation(state.code, S.date);
    $('snapTag').textContent = S.date;
    if (!v) {
      ['vPb', 'vPe', 'vTtm', 'vDiv'].forEach(function (id) { $(id).textContent = '--'; });
      return;
    }
    $('vPb').textContent = v.pb ? v.pb.toFixed(2) : '--';
    $('vPe').textContent = v.pe ? v.pe.toFixed(1) : '--';
    $('vTtm').textContent = v.peTtm ? v.peTtm.toFixed(1) : '--';
    $('vDiv').textContent = v.divYield ? (v.divYield * 100).toFixed(2) + '%' : '--';
    $('vPbS').textContent = v.report ? v.report.date + ' 净资产' : '暂无已披露报表';
    var annual = M.latestReport(state.code, S.date, true);
    $('vPeS').textContent = annual ? annual.date.slice(0, 4) + ' 年报' : '暂无年报';
  }

  function renderGrowth() {
    var st = M.stock(state.code);
    var reps = M.visibleReports(state.code, S.date).slice(-8);
    var unit = st.currency === 'HKD' ? '亿港元' : '亿元';
    $('growthTag').textContent = unit;
    if (!reps.length) {
      growth.clear();
      growth.setOption({
        title: {
          text: '该时点尚无已披露财报', left: 'center', top: 'middle',
          textStyle: { fontSize: 10, color: C.faint, fontWeight: 400 }
        }
      });
      return;
    }
    var cats = reps.map(function (r) { return r.date.slice(2, 7); });
    var rev = reps.map(function (r) {
      var v = M.convert(r.revQ, r.cur, st.currency, r.disc);
      return v === null ? null : +(v / 1e8).toFixed(2);
    });
    var np = reps.map(function (r) {
      var v = M.convert(r.npQ, r.cur, st.currency, r.disc);
      return v === null ? null : +(v / 1e8).toFixed(2);
    });
    growth.setOption({
      animation: false,
      grid: { left: 40, right: 8, top: 16, bottom: 18 },
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: C.ink, fontSize: 10 }
      },
      xAxis: { type: 'category', data: cats, axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { fontSize: 8, color: C.faint } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 8, color: C.faint }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } },
      series: [
        { name: '营收', type: 'bar', data: rev, barMaxWidth: 9, itemStyle: { color: 'rgba(30,58,95,.55)', borderRadius: [2, 2, 0, 0] } },
        { name: '归母', type: 'bar', data: np, barMaxWidth: 9, itemStyle: { color: 'rgba(176,122,46,.75)', borderRadius: [2, 2, 0, 0] } }
      ]
    }, true);
  }

  function renderReports() {
    var st = M.stock(state.code);
    var reps = M.visibleReports(state.code, S.date).slice(-8).reverse();
    var unit = st.currency === 'HKD' ? '亿港元' : '亿元';
    $('reportTag').textContent = reps.length ? reps.length + ' 期 · ' + unit : '暂无';
    if (!reps.length) {
      $('reportBody').innerHTML = '<tr><td colspan="4" class="empty">该时点尚无已披露财报</td></tr>';
      return;
    }
    $('reportBody').innerHTML = reps.map(function (r) {
      var rev = M.convert(r.revQ, r.cur, st.currency, r.disc);
      var np = M.convert(r.npQ, r.cur, st.currency, r.disc);
      var eps = M.convert(r.epsQ, r.cur, st.currency, r.disc);
      return '<tr><td>' + r.date.slice(0, 7) + (r.est ? '<span class="small"> 估</span>' : '') + '</td>' +
        '<td class="n">' + (rev === null ? '--' : (rev / 1e8).toFixed(1)) + '</td>' +
        '<td class="n">' + (np === null ? '--' : (np / 1e8).toFixed(1)) + '</td>' +
        '<td class="n">' + (eps === null ? '--' : eps.toFixed(2)) + '</td></tr>';
    }).join('');
  }

  function renderCurve() {
    var eq = E.equity();
    $('curveTag').textContent = E.metrics().days + ' 天';
    if (!eq.length) { curve.clear(); return; }
    var step = Math.max(1, Math.floor(eq.length / 300));
    var data = eq.filter(function (x, i) { return i % step === 0 || i === eq.length - 1; });
    var base = S.initCash;
    curve.setOption({
      animation: false,
      grid: { left: 44, right: 8, top: 12, bottom: 16 },
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: C.ink, fontSize: 10 },
        formatter: function (ps) {
          var p = ps[0];
          return p.axisValue + '<br>' + U.money(p.value);
        }
      },
      xAxis: { type: 'category', data: data.map(function (x) { return x.d; }), axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { fontSize: 8, color: C.faint, hideOverlap: true } },
      yAxis: { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 8, color: C.faint, formatter: function (v) { return (v / 1e4).toFixed(0) + '万'; } }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } },
      series: [{
        type: 'line', data: data.map(function (x) { return x.v; }), symbol: 'none',
        lineStyle: { width: 1.4, color: C.accent },
        areaStyle: { color: 'rgba(30,58,95,.07)' },
        markLine: {
          silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: C.faint, type: 'dashed', width: 1 },
          data: [{ yAxis: base }]
        }
      }]
    }, true);
  }

  function renderLedger() {
    var body = $('ledgerBody');
    if (state.tab === 'pos') {
      var rows = Object.keys(S.pos).filter(function (c) { return S.pos[c].shares > 0; });
      rows.sort(function (a, b) { return value(a) - value(b); });
      $('ledgerMeta').textContent = rows.length + ' 只持仓';
      if (!rows.length) {
        body.innerHTML = '<div class="empty">还没有持仓。在下方输入股数，或点 5% / 10% / 20% / 25% / 30% / 50% / 全仓 建仓。</div>';
        return;
      }
      body.innerHTML = '<table><thead><tr><th>标的</th><th class="n">股数</th><th class="n">成本(¥)</th><th class="n">现价</th><th class="n">市值(¥)</th><th class="n">盈亏</th><th></th></tr></thead><tbody>' +
        rows.map(function (code) {
          var p = S.pos[code], st = M.stock(code);
          var px = priceOf(code) || 0;
          var mv = cny(code, p.shares * px);
          var pnl = mv - p.cost;
          var pnlPct = p.cost ? pnl / p.cost : 0;
          return '<tr><td><b>' + U.esc(st.name) + '</b><span class="code">' + code + '</span></td>' +
            '<td class="n">' + p.shares.toLocaleString('en-US') + '</td>' +
            '<td class="n">' + (p.cost / p.shares).toFixed(2) + '</td>' +
            '<td class="n">' + U.px(px, st.currency) + '</td>' +
            '<td class="n">' + Math.round(mv).toLocaleString('en-US') + '</td>' +
            '<td class="n ' + U.cls(pnl) + '">' + (pnl >= 0 ? '+' : '') + Math.round(pnl).toLocaleString('en-US') +
            ' <span class="small">' + U.pct(pnlPct) + '</span></td>' +
            '<td><button class="lbtn buy-b" data-buy="' + code + '">买</button><button class="lbtn sell-b" data-sell="' + code + '">卖</button></td></tr>';
        }).join('') + '</tbody></table>';
      return;
    }
    if (state.tab === 'trade') {
      var ts = S.trades.slice(-60).reverse();
      $('ledgerMeta').textContent = S.trades.length + ' 笔成交';
      if (!ts.length) { body.innerHTML = '<div class="empty">还没有成交记录。</div>'; return; }
      body.innerHTML = '<table><thead><tr><th>日期</th><th>标的</th><th>方向</th><th class="n">股数</th><th class="n">价格</th><th class="n">费用(¥)</th><th class="n">金额(¥)</th></tr></thead><tbody>' +
        ts.map(function (t) {
          return '<tr><td class="mono">' + t.date + '</td><td><b>' + U.esc(t.name) + '</b></td>' +
            '<td class="' + (t.side === 'buy' ? 'buy' : 'sell') + '">' + (t.side === 'buy' ? '买入' : '卖出') + '</td>' +
            '<td class="n">' + t.qty.toLocaleString('en-US') + '</td>' +
            '<td class="n">' + U.px(t.price, t.cur) + '</td>' +
            '<td class="n">' + t.fee.toFixed(2) + '</td>' +
            '<td class="n">' + Math.round(t.amount).toLocaleString('en-US') + '</td></tr>';
        }).join('') + '</tbody></table>';
      return;
    }
    var ds = S.divs.slice(-60).reverse();
    $('ledgerMeta').textContent = S.divs.length + ' 笔分红';
    if (!ds.length) { body.innerHTML = '<div class="empty">还没有分红记录。持有到除权日会自动结算。</div>'; return; }
    body.innerHTML = '<table><thead><tr><th>除权日</th><th>标的</th><th class="n">每股</th><th class="n">股数</th><th class="n">税前</th><th class="n">红利税</th><th class="n">税后(¥)</th><th class="n">复投</th></tr></thead><tbody>' +
      ds.map(function (d) {
        return '<tr><td class="mono">' + d.date + '</td><td><b>' + U.esc(d.name) + '</b></td>' +
          '<td class="n">' + d.dps.toFixed(3) + '</td>' +
          '<td class="n">' + d.qty.toLocaleString('en-US') + '</td>' +
          '<td class="n">' + Math.round(d.gross).toLocaleString('en-US') + '</td>' +
          '<td class="n">' + Math.round(d.tax).toLocaleString('en-US') + '</td>' +
          '<td class="n">' + Math.round(d.net).toLocaleString('en-US') + '</td>' +
          '<td class="n">' + (d.shares ? d.shares.toLocaleString('en-US') : '--') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function value(code) {
    var px = priceOf(code) || 0;
    return cny(code, S.pos[code].shares * px);
  }

  function renderDock() {
    var st = M.stock(state.code), px = priceOf(state.code);
    $('dTarget').textContent = st.name + ' ' + state.code;
    $('dPrice').textContent = px === null ? '未上市' : U.px(px, st.currency);
    var unit = px === null ? 0 : cny(state.code, px);
    var lotN = lot(state.code);
    var max = unit ? Math.floor(S.cash / (unit * 1.0003) / lotN) * lotN : 0;
    $('cashTip').textContent = '可用 ' + U.money(S.cash) + ' · 最多 ' + max.toLocaleString('en-US') + ' 股';
  }

  /* ---------- 交互 ---------- */
  function bind() {
    $('stockSel').addEventListener('change', function () {
      state.code = this.value;
      $('qty').value = '';
      renderAll();
    });

    $('tbSlots').addEventListener('click', function () { U.slotsDialog(); });

    $('cycToggle').addEventListener('change', function () { SB.cycle.toggle(this.checked); });
    $('cycRun').addEventListener('click', function () { SB.cycle.derive(); });

    $('pSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.period = b.getAttribute('data-p');
      [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      renderChart();
    });

    $('mSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.mode = b.getAttribute('data-m');
      [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      renderChart();
    });

    $('ledgerTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.tab = b.getAttribute('data-tab');
      [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      renderLedger();
    });

    $('ledgerBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-buy],[data-sell]');
      if (!b) return;
      state.code = b.getAttribute('data-buy') || b.getAttribute('data-sell');
      renderAll();
      if (b.getAttribute('data-sell')) $('qty').value = E.shares(state.code);
      else $('qty').value = '';
      $('qty').focus();
    });

    $('tbRange').addEventListener('input', function () {
      $('tbDate').textContent = E.calendar()[+this.value];
    });
    $('tbRange').addEventListener('change', function () {
      jumpTo(E.calendar()[+this.value]);
    });

    document.querySelector('.tb-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      var step = b.getAttribute('data-step');
      var cal = E.calendar();
      if (step === 'today') return jumpTo(cal[cal.length - 1]);
      var months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36 }[step];
      var d = new Date(S.date + 'T00:00:00Z');
      var day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + months);
      d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
      jumpTo(d.toISOString().slice(0, 10));
    });

    $('tbGo').addEventListener('click', function () {
      var d = $('tbJump').value;
      if (!d) return U.toast('先选一个日期');
      jumpTo(d);
    });

    $('qty').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doTrade('buy');
    });

    $('drip').addEventListener('change', function () {
      E.setDrip(this.checked);
      U.toast(this.checked ? '分红将按现价自动复投' : '分红将计入现金');
    });

    $('buyBtn').addEventListener('click', function () { doTrade('buy'); });
    $('sellBtn').addEventListener('click', function () { doTrade('sell'); });

    document.querySelector('.dock .tb-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pct]');
      if (!b) return;
      var v = b.getAttribute('data-pct');
      var lotN = lot(state.code), px = priceOf(state.code);
      if (!px) return U.toast('该时点无行情');
      if (v === 'all-sell') {
        $('qty').value = E.shares(state.code) || '';
        return;
      }
      var unit = cny(state.code, px);
      var max = Math.floor(S.cash / (unit * 1.0003) / lotN) * lotN;
      var qty = v === '1' ? max : Math.floor(max * Number(v) / lotN) * lotN;
      $('qty').value = Math.max(qty, 0) || '';
    });
  }

  function jumpTo(date) {
    var cal = E.calendar();
    var target = cal[cal.indexOf(S.date)];
    if (date <= S.date) {
      U.toast('时间只能向前推进');
      renderTime();
      return;
    }
    var before = S.divs.length;
    E.advanceTo(date);
    S = E.session();
    var gained = S.divs.length - before;
    U.toast('推进至 ' + S.date + (gained ? ' · 结算 ' + gained + ' 笔分红' : ''));
    renderAll();
  }

  function doTrade(side) {
    var qty = Math.floor(Number($('qty').value) || 0);
    if (!qty) return U.toast('请输入股数');
    var r = E.trade(state.code, side, qty);
    U.toast(r.msg);
    if (r.ok) {
      $('qty').value = '';
      renderAll();
    }
  }
})();
