/* 复盘报告：指标、资产曲线、持仓、流水与导出 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var C = { up: '#C0453B', down: '#2E7D5B', muted: '#6A7280', faint: '#9AA0A8', rule: '#EFEBE2', accent: '#1E3A5F', gold: '#B07A2E' };
  var S = null, rvCurve, rvMark;

  function $(id) { return document.getElementById(id); }

  SB.market.load().then(function () {
    E.init();
    S = E.load();
    U.header('review');
    if (!S) {
      U.requireSession();
      return;
    }
    $('rvSub').textContent = S.startDate + ' → ' + S.date + ' · 初始本金 ' + U.money(S.initCash) +
      ' · ' + E.metrics().days + ' 天';
    rvCurve = echarts.init($('rvCurve'));
    rvMark = echarts.init($('rvMark'));
    render();
    window.addEventListener('resize', function () { rvCurve.resize(); rvMark.resize(); });
  }).catch(function (e) {
    U.toast('数据加载失败：' + e.message);
  });

  function maxDrawdown(eq) {
    var peak = -Infinity, dd = 0;
    eq.forEach(function (x) {
      if (x.v > peak) peak = x.v;
      var d = peak ? x.v / peak - 1 : 0;
      if (d < dd) dd = d;
    });
    return dd;
  }

  function render() {
    var m = E.metrics();
    var eq = E.equity();
    var dd = maxDrawdown(eq);
    var fees = S.trades.reduce(function (a, t) { return a + t.fee; }, 0);

    $('kpis').innerHTML = [
      ['期末总资产', U.money(m.total), S.date],
      ['累计收益', U.pct(m.ret), '本金 ' + U.money(S.initCash)],
      ['年化收益', m.cagr === null ? '--' : U.pct(m.cagr), m.days + ' 天'],
      ['最大回撤', (Math.abs(dd) * 100).toFixed(2) + '%', '按日资产曲线'],
      ['累计分红', U.money(m.div), '税后 ' + S.divs.length + ' 笔']
    ].map(function (k, i) {
      var color = i === 1 || i === 2 ? U.cls(i === 1 ? m.ret : (m.cagr || 0)) : (i === 3 && dd < 0 ? 'down' : '');
      return '<div class="kpi"><span>' + k[0] + '</span><b class="' + color + '">' + k[1] + '</b><em>' + k[2] + '</em></div>';
    }).join('');

    renderCurve(eq);
    renderMark(m, fees);
    renderHoldings();
    renderDivs();
    renderTrades();

    $('expJson').onclick = function () {
      U.download('snowball-' + S.startDate + '-' + S.date + '.json', JSON.stringify(S, null, 2), 'application/json');
    };
    $('expCsv').onclick = exportCsv;
    $('printBtn').onclick = function () { window.print(); };
    $('restart').onclick = function () {
      if (!confirm('确定结束当前复盘并重新开始？本机记录将被清除。')) return;
      E.clear();
      location.href = 'setup.html';
    };
  }

  function benchAt(date) {
    var total = 0, n = 0;
    S.initialWatch.forEach(function (code) {
      if (!M.listed(code, S.startDate)) return;
      var a = M.barAt(code, S.startDate), b = M.barAt(code, date);
      if (!a || !b) return;
      total += M.adjustedClose(code, b.idx, 'qfq') / M.adjustedClose(code, a.idx, 'qfq') - 1;
      n++;
    });
    return n ? S.initCash * (1 + total / n) : S.initCash;
  }

  function renderCurve(eq) {
    if (!eq.length) return;
    var step = Math.max(1, Math.floor(eq.length / 300));
    var pts = eq.filter(function (x, i) { return i % step === 0 || i === eq.length - 1; });
    var lows = pts.map(function (x) { return x.v; });
    var bench = pts.map(function (x) { return benchAt(x.d); });
    $('curveTag').textContent = '基准 ' + U.money(E.benchmark()) + ' · 超额 ' + U.pct(E.benchmark() ? E.metrics().total / E.benchmark() - 1 : 0);

    rvCurve.setOption({
      animation: false,
      grid: { left: 54, right: 14, top: 18, bottom: 24 },
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: '#1C2126', fontSize: 11 },
        formatter: function (ps) {
          var s = '<b>' + ps[0].axisValue + '</b>';
          ps.forEach(function (p) {
            s += '<br>' + p.marker + p.seriesName + '：' + U.money(p.value);
          });
          return s;
        }
      },
      legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 10, color: C.muted } },
      xAxis: { type: 'category', data: pts.map(function (x) { return x.d; }), axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint, hideOverlap: true } },
      yAxis: { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint, formatter: function (v) { return (v / 1e4).toFixed(0) + '万'; } }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } },
      series: [
        {
          name: '我的账户', type: 'line', data: pts.map(function (x) { return x.v; }), symbol: 'none',
          lineStyle: { width: 1.8, color: C.accent },
          areaStyle: { color: 'rgba(30,58,95,.06)' }
        },
        {
          name: '等权买入持有', type: 'line', data: bench, symbol: 'none',
          lineStyle: { width: 1.2, color: C.gold, type: 'dashed' }
        }
      ]
    }, true);
  }

  function renderMark(m, fees) {
    var pricePnl = m.total - S.initCash - m.div + fees;
    var rows = [
      { name: '价差收益', value: pricePnl, color: pricePnl >= 0 ? C.up : C.down },
      { name: '税后分红', value: m.div, color: C.gold },
      { name: '交易费用', value: -fees, color: C.faint }
    ];
    rvMark.setOption({
      animation: false,
      grid: { left: 72, right: 30, top: 20, bottom: 16 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: '#1C2126', fontSize: 11 },
        formatter: function (ps) { return ps[0].name + '：' + U.money(ps[0].value); }
      },
      xAxis: { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint, formatter: function (v) { return Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(0) + '万' : Math.round(v).toLocaleString('en-US'); } }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } },
      yAxis: { type: 'category', data: rows.map(function (r) { return r.name; }), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 11, color: C.ink } },
      series: [{
        type: 'bar', data: rows.map(function (r) { return { value: +r.value.toFixed(0), itemStyle: { color: r.color, borderRadius: [0, 3, 3, 0] } }; }),
        barWidth: 18,
        label: { show: true, position: 'right', fontSize: 10, color: C.muted, formatter: function (p) { return U.short(p.value); } }
      }]
    }, true);
  }

  function renderHoldings() {
    var codes = Object.keys(S.pos).filter(function (c) { return S.pos[c].shares > 0; });
    var totalMv = E.marketValue(S.date);
    $('holdTag').textContent = codes.length + ' 只 · 市值 ' + U.money(totalMv);
    if (!codes.length) {
      $('holdBody').innerHTML = '<div class="empty">期末无持仓。</div>';
      return;
    }
    codes.sort(function (a, b) { return E.shares(b) - E.shares(a); });
    $('holdBody').innerHTML = '<table><thead><tr><th>标的</th><th class="n">股数</th><th class="n">成本(¥)</th><th class="n">现价</th><th class="n">市值(¥)</th><th class="n">盈亏</th><th class="n">占比</th></tr></thead><tbody>' +
      codes.map(function (code) {
        var st = M.stock(code), p = S.pos[code];
        var px = M.priceAt(code, S.date) || 0;
        var mv = p.shares * px * M.toCNY(1, st.currency, S.date);
        var pnl = mv - p.cost;
        return '<tr><td><b>' + U.esc(st.name) + '</b><br><span class="small mono">' + code + '</span></td>' +
          '<td class="n">' + p.shares.toLocaleString('en-US') + '</td>' +
          '<td class="n">' + (p.cost / p.shares).toFixed(2) + '</td>' +
          '<td class="n">' + U.px(px, st.currency) + '</td>' +
          '<td class="n">' + Math.round(mv).toLocaleString('en-US') + '</td>' +
          '<td class="n ' + U.cls(pnl) + '">' + (pnl >= 0 ? '+' : '-') + Math.round(Math.abs(pnl)).toLocaleString('en-US') + '</td>' +
          '<td class="n">' + (totalMv ? (mv / totalMv * 100).toFixed(1) : '0.0') + '%</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderDivs() {
    var ds = S.divs.slice().reverse();
    $('divTag').textContent = ds.length + ' 笔';
    if (!ds.length) {
      $('divBody').innerHTML = '<div class="empty">期间没有分红记录。</div>';
      return;
    }
    $('divBody').innerHTML = '<table><thead><tr><th>除权日</th><th>标的</th><th class="n">每股</th><th class="n">股数</th><th class="n">税后(¥)</th><th class="n">复投</th></tr></thead><tbody>' +
      ds.map(function (d) {
        return '<tr><td class="mono">' + d.date + '</td><td>' + U.esc(d.name) + '</td>' +
          '<td class="n">' + d.dps.toFixed(3) + '</td>' +
          '<td class="n">' + d.qty.toLocaleString('en-US') + '</td>' +
          '<td class="n">' + Math.round(d.net).toLocaleString('en-US') + '</td>' +
          '<td class="n">' + (d.shares ? d.shares.toLocaleString('en-US') : '--') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderTrades() {
    var ts = S.trades.slice().reverse();
    $('tradeTag').textContent = ts.length + ' 笔';
    if (!ts.length) {
      $('tradeBody').innerHTML = '<div class="empty">期间没有成交。</div>';
      return;
    }
    $('tradeBody').innerHTML = '<table><thead><tr><th>日期</th><th>标的</th><th>方向</th><th class="n">股数</th><th class="n">价格</th><th class="n">费用(¥)</th><th class="n">金额(¥)</th></tr></thead><tbody>' +
      ts.map(function (t) {
        return '<tr><td class="mono">' + t.date + '</td><td>' + U.esc(t.name) + '</td>' +
          '<td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? '买入' : '卖出') + '</td>' +
          '<td class="n">' + t.qty.toLocaleString('en-US') + '</td>' +
          '<td class="n">' + U.px(t.price, t.cur) + '</td>' +
          '<td class="n">' + t.fee.toFixed(2) + '</td>' +
          '<td class="n">' + Math.round(t.amount).toLocaleString('en-US') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function exportCsv() {
    var rows = [['日期', '代码', '名称', '方向', '股数', '价格', '币种', '汇率', '费用CNY', '金额CNY']];
    S.trades.forEach(function (t) {
      rows.push([t.date, t.code, t.name, t.side === 'buy' ? '买入' : '卖出', t.qty, t.price, t.cur, t.fx, t.fee, t.amount]);
    });
    U.download('snowball-trades-' + S.startDate + '-' + S.date + '.csv', '\ufeff' + U.csv(rows), 'text/csv;charset=utf-8');
  }

})();
