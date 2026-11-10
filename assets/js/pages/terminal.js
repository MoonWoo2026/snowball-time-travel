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
  var state = { code: null, period: 'day', mode: 'qfq', tab: 'pos', growthMetric: 'rev', growthPeriod: 'Q',
    god: { on: false, kind: 'pb', x: 0.9 } };
  var chart, growth, curve;
  var playTimer = null;
  var godCache = { pts: [], areas: [] };

  function addMonths(dateStr, months) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    return d.toISOString().slice(0, 10);
  }

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
    U.loadFail(e);
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
    syncUndo();
    U.refreshHead();
    if (SB.cycle) SB.cycle.sync();
  }

  function syncUndo() {
    var n = E.undoCount();
    var b = $('tbUndo');
    b.disabled = !n;
    b.textContent = n ? '撤销 ' + n : '撤销';
  }

  function doUndo() {
    var r = E.undoTrade();
    if (!r.ok) return U.toast(r.msg);
    S = E.session();
    if (!M.stock(state.code)) state.code = S.watch[0];
    U.toast(r.msg);
    renderAll();
  }

  function renderAcct() {
    var m = E.metrics();
    $('aTotal').textContent = U.money(m.total);
    $('aCash').textContent = U.money(m.cash);
    $('aMv').textContent = U.money(m.mv);
    var onBuy = $('aFromBuy').checked && m.buy;
    var ret = $('aRet'), cagr = $('aCagr');
    if (onBuy) {
      $('aRetLbl').textContent = '买入后收益';
      $('aCagrLbl').textContent = '买入后年化';
      ret.textContent = U.pct(m.buy.ret);
      ret.className = U.cls(m.buy.ret);
      cagr.textContent = m.buy.cagr === null ? '--' : U.pct(m.buy.cagr);
      cagr.className = U.cls(m.buy.cagr || 0);
      $('aFromBuy').title = '基准 ' + m.buy.from + ' 总资产 ' + U.money(m.buy.base) + ' · ' + m.buy.days + ' 天';
    } else {
      $('aRetLbl').textContent = '累计收益';
      $('aCagrLbl').textContent = '年化收益';
      ret.textContent = U.pct(m.ret);
      ret.className = U.cls(m.ret);
      cagr.textContent = m.cagr === null ? '--' : U.pct(m.cagr);
      cagr.className = U.cls(m.cagr || 0);
      $('aFromBuy').title = m.firstBuy
        ? '以首次买入日 ' + m.firstBuy + ' 的组合总资产为基准'
        : '还没有买入记录，勾选后暂无可比基准';
    }
    $('aDiv').textContent = U.money(m.div);
    var idx = M.indexAt(S.date);
    var iEl = $('aIdx');
    if (idx) {
      iEl.textContent = idx.close.toFixed(2) + ' ' + U.pct(idx.chg);
      iEl.className = U.cls(idx.chg);
      iEl.title = '上证指数 ' + idx.date + ' 收盘 ' + idx.close.toFixed(2) + '，较前一交易日 ' + U.pct(idx.chg);
    } else {
      iEl.textContent = '--';
      iEl.className = '';
    }
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
    godCache = godPoints(code, bars, startPos, all);
    updateGodTip(godCache);
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
          var gv = null;
          for (var gi = 0; gi < godCache.pts.length; gi++) {
            if (godCache.pts[gi].value[0] === ps[0].dataIndex) { gv = godCache.pts[gi].mv; break; }
          }
          return '<b>' + b.key + '</b><br>' +
            '开 ' + b.open.toFixed(2) + '　高 ' + b.high.toFixed(2) + '<br>' +
            '低 ' + b.low.toFixed(2) + '　收 <span style="color:' + pc + '">' + b.close.toFixed(2) + '</span><br>' +
            '量 ' + (b.volume / 1e4).toFixed(1) + '万' +
            (gv === null ? '' : '<br><span style="color:' + C.gold + '">' +
              (state.god.kind === 'pb' ? 'PB ' : 'PE ') + gv.toFixed(2) + ' 倍</span>');
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
      ].concat(godSeries())
    }, true);
  }

  /* 上帝视角：找出历史上估值低于阈值的连续区间，区间内最低点打标，并给区间上淡色底 */
  function godPoints(code, bars, startPos, all) {
    var st = M.stock(code);
    if (!st || !state.god.on) return { pts: [], areas: [] };
    var vs = M.valuationSeries(code, S.date);
    if (!vs.length) return { pts: [], areas: [] };
    var vm = {};
    vs.forEach(function (o) { vm[o.date] = o; });
    var k = state.god.kind, x = state.god.x;
    var pts = [], areas = [], runStart = null, runMin = null, runMinGi = 0;

    function closeRun(endGi) {
      if (runStart === null) return;
      areas.push({ a: runStart, b: endGi });
      pts.push({ value: [runMinGi, bars[runMinGi].low], mv: runMin });
      runStart = null; runMin = null;
    }

    for (var gi = 0; gi < bars.length; gi++) {
      var b = all[startPos + gi];
      if (!b) continue;
      var minV = null;
      for (var dj = b.startIdx; dj <= b.endIdx; dj++) {
        var o = vm[st.bars[dj][0]];
        if (!o) continue;
        var v = o[k];
        if (v !== null && v !== undefined && v > 0 && (minV === null || v < minV)) minV = v;
      }
      if (minV !== null && minV <= x) {
        if (runStart === null) { runStart = gi; runMin = minV; runMinGi = gi; }
        else if (minV < runMin) { runMin = minV; runMinGi = gi; }
      } else {
        closeRun(gi - 1);
      }
    }
    closeRun(bars.length - 1);
    return { pts: pts, areas: areas };
  }

  function godSeries() {
    if (!godCache.pts.length) return [];
    return [{
      name: '上帝视角', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
      data: godCache.pts, symbol: 'circle', symbolSize: 7, z: 6,
      itemStyle: { color: C.gold, borderColor: '#fff', borderWidth: 1 },
      label: {
        show: true, position: 'bottom', fontSize: 8, color: C.gold,
        formatter: function (p) { return p.data.mv.toFixed(2); }
      },
      labelLayout: { hideOverlap: true },
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(176,122,46,.07)' },
        data: godCache.areas.map(function (a) {
          return [{ xAxis: a.a }, { xAxis: a.b }];
        })
      }
    }];
  }

  function updateGodTip(rep) {
    var el = $('godTip');
    if (!el) return;
    if (!state.god.on) {
      el.textContent = '标出历史上估值低于该值的交易日';
      return;
    }
    el.textContent = (state.god.kind === 'pb' ? 'PB' : 'PE') + ' ≤ ' + state.god.x +
      ' 倍 · 共 ' + rep.areas.length + ' 段';
  }

  function renderValuation() {
    var v = M.valuation(state.code, S.date);
    var rs = M.roeStats(state.code, S.date);
    $('snapTag').textContent = S.date;
    function pct(x) {
      return (x === null || x === undefined || !isFinite(x)) ? '--' : (x * 100).toFixed(1) + '%';
    }
    $('vRoe').textContent = rs ? pct(rs.ttm) : '--';
    $('vRoe1').textContent = rs ? pct(rs.y1) : '--';
    $('vRoe3').textContent = rs ? pct(rs.y3) : '--';
    $('vRoe5').textContent = rs ? pct(rs.y5) : '--';
    $('vRoe1Y').textContent = rs && rs.y1Year ? rs.y1Year + ' 年报' : '';
    $('vRoeS').textContent = rs && rs.ttm !== null
      ? (v && v.report ? v.report.date + ' 近 12 个月归母' : '近 12 个月归母')
      : '暂无已披露报表';
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

  var GROWTH_METRICS = {
    rev:   { label: '营业总收入', q: 'revQ',   y: 'rev' },
    np:    { label: '归母净利润', q: 'npQ',    y: 'np' },
    npNon: { label: '扣非净利润', q: 'npNonQ', y: 'npNon' }
  };
  var QCOLORS = ['#B8C7D9', '#8FA8C2', '#5E83A8', '#1E3A5F'];  /* Q1→Q4 由浅到深 */
  var QNAMES = ['一季度', '二季度', '三季度', '四季度'];

  function qOf(dateStr) {
    var m = Number(dateStr.slice(5, 7));
    return m === 3 ? 0 : m === 6 ? 1 : m === 9 ? 2 : 3;
  }

  function renderGrowth() {
    var st = M.stock(state.code);
    var reps = M.visibleReports(state.code, S.date);
    var unit = st.currency === 'HKD' ? '亿港元' : '亿元';
    var curMetric = GROWTH_METRICS[state.growthMetric];

    /* 各指标最新单期值（显示在指标 tab 上） */
    var last = reps[reps.length - 1];
    function lastVal(field) {
      if (!last || last[field] == null) return null;
      var v = M.convert(last[field], last.cur, st.currency, last.disc);
      return v === null ? null : v / 1e8;
    }
    function fmtBig(v) {
      if (v === null || v === undefined || isNaN(v)) return '--';
      return (v >= 0 ? '' : '-') + Math.abs(v).toFixed(2) + '亿';
    }
    $('mRev').textContent = fmtBig(lastVal('revQ'));
    $('mNp').textContent = fmtBig(lastVal('npQ'));
    $('mNon').textContent = fmtBig(lastVal('npNonQ'));

    if (!reps.length) {
      growth.clear();
      growth.setOption({ title: { text: '该时点尚无已披露财报', left: 'center', top: 'middle',
        textStyle: { fontSize: 10, color: C.faint, fontWeight: 400 } } });
      $('growthThead').innerHTML = '';
      $('growthTbody').innerHTML = '<tr><td class="empty">该时点尚无已披露财报</td></tr>';
      return;
    }

    /* 按财年聚合：每年一个对象，存每季单期值 + 年累计值 */
    var fyMap = {};
    var fyList = [];
    reps.forEach(function (r) {
      var fy = r.fy || r.date.slice(0, 4);
      if (!fyMap[fy]) { fyMap[fy] = { fy: fy, q: [null, null, null, null], annual: {} }; fyList.push(fyMap[fy]); }
      var qi = qOf(r.date);
      fyMap[fy].q[qi] = M.convert(r[curMetric.q], r.cur, st.currency, r.disc);
      /* 年报累计值（取该财年最后一份报告的累计口径） */
      ['rev', 'np', 'npNon', 'eps'].forEach(function (k) {
        if (r[k] != null) fyMap[fy].annual[k] = M.convert(r[k], r.cur, st.currency, r.disc);
      });
    });
    /* 取最近 8 个财年 */
    var years = fyList.slice(-8);
    var xCats = years.map(function (y) { return y.fy; });

    var series, legend;
    if (state.growthPeriod === 'Q') {
      legend = { data: QNAMES, bottom: 0, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 9, color: C.faint } };
      series = QNAMES.map(function (name, i) {
        return {
          name: name, type: 'bar', stack: null, barMaxWidth: 14,
          data: years.map(function (y) { return y.q[i] === null ? null : +(y.q[i] / 1e8).toFixed(2); }),
          itemStyle: { color: QCOLORS[i], borderRadius: [2, 2, 0, 0] }
        };
      });
    } else {
      legend = null;
      series = [{
        name: curMetric.label, type: 'bar', barMaxWidth: 22,
        data: years.map(function (y) {
          var v = y.annual[curMetric.y];
          return v == null ? null : +(v / 1e8).toFixed(2);
        }),
        itemStyle: { color: C.accent, borderRadius: [3, 3, 0, 0] }
      }];
    }

    growth.setOption({
      animation: false,
      grid: { left: 44, right: 10, top: 12, bottom: legend ? 28 : 18 },
      legend: legend,
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: C.ink, fontSize: 10 },
        valueFormatter: function (v) { return v == null ? '--' : v + ' ' + unit; }
      },
      xAxis: { type: 'category', data: xCats, axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: C.faint } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 8, color: C.faint }, splitLine: { lineStyle: { color: C.rule, type: 'dashed' } } },
      series: series
    }, true);

    /* 年度汇总表：列为财年，行为 营收/归母/扣非/EPS */
    var head = '<th>指标</th>' + years.map(function (y) { return '<th class="n">' + y.fy + '</th>'; }).join('');
    $('growthThead').innerHTML = head;
    var rows = [
      { key: 'rev',   label: '营业总收入' },
      { key: 'np',    label: '归母净利润' },
      { key: 'npNon', label: '扣非净利润' },
      { key: 'eps',   label: 'EPS', isEps: true }
    ];
    $('growthTbody').innerHTML = rows.map(function (row) {
      var tds = years.map(function (y) {
        var v = y.annual[row.key];
        var txt;
        if (v == null) txt = '--';
        else if (row.isEps) txt = v.toFixed(2);
        else txt = (v / 1e8).toFixed(1) + '亿';
        return '<td class="n">' + txt + '</td>';
      }).join('');
      return '<tr><td>' + row.label + '</td>' + tds + '</tr>';
    }).join('');
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
    renderDeal();
  }

  /* 交易条资金行：可用现金 + 可卖股数 + 实时成交试算（随股数输入联动） */
  function renderDeal() {
    var el = $('dealInfo');
    if (!el) return;
    var st = M.stock(state.code), px = priceOf(state.code);
    var held = E.shares(state.code) || 0;
    var unit = px === null ? 0 : cny(state.code, px);
    var lotN = lot(state.code);
    var maxBuy = unit ? Math.floor(S.cash / (unit * 1.0003) / lotN) * lotN : 0;
    var q = Math.floor(Number($('qty').value) || 0);

    var h = '<span><span class="k">可用现金</span> <b>' + U.money(S.cash) + '</b></span>';
    if (held) h += '<span><span class="k">可卖</span> <b>' + held.toLocaleString('en-US') + '</b> 股</span>';

    if (!q) {
      h += '<span class="k">最多可买 ' + maxBuy.toLocaleString('en-US') + ' 股 · 填入股数后显示这笔要花多少、买后剩多少</span>';
    } else if (!unit) {
      h += '<span class="warn">该时点无行情，无法成交</span>';
    } else {
      var amt = q * unit;
      var feeB = E.fees(state.code, q, px, 'buy', S.date).cny;
      var afterB = S.cash - amt - feeB;
      h += '<span><span class="k">成交金额</span> <b>' + U.money(amt) + '</b><span class="k">（含费 ' + U.money(feeB) + '）</span></span>';
      if (afterB >= -1e-6) {
        h += '<span><span class="k">买入后现金</span> <b>' + U.money(afterB) + '</b></span>';
      } else {
        h += '<span class="warn">买入还差 <b>' + U.money(-afterB) + '</b></span>';
      }
      if (held >= q) {
        var feeS = E.fees(state.code, q, px, 'sell', S.date).cny;
        h += '<span><span class="k">卖出后现金</span> <b class="pos">' + U.money(S.cash + amt - feeS) + '</b></span>';
      }
    }
    el.innerHTML = h;
  }

  /* ---------- 交互 ---------- */
  function bind() {
    $('aFromBuy').addEventListener('change', function () {
      if (this.checked && !E.metrics().buy) {
        this.checked = false;
        U.toast('还没有买入记录，先买一笔再看买入后收益');
        return;
      }
      renderAcct();
    });

    $('stockSel').addEventListener('change', function () {
      state.code = this.value;
      $('qty').value = '';
      renderAll();
    });

    $('godRun').addEventListener('click', function () {
      var x = Number($('godX').value);
      if (!(x > 0)) return U.toast('请输入大于 0 的倍数');
      state.god = { on: true, kind: $('godKind').value, x: x };
      this.classList.add('on');
      renderChart();
    });

    $('godClear').addEventListener('click', function () {
      state.god.on = false;
      $('godRun').classList.remove('on');
      renderChart();
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
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderChart();
    });

    $('growthMetric').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.growthMetric = b.getAttribute('data-m');
      [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      renderGrowth();
    });

    $('growthPeriod').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.growthPeriod = b.getAttribute('data-p');
      [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      renderGrowth();
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
      renderDeal();
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
      jumpTo(addMonths(S.date, months));
    });

    $('waitGo').addEventListener('click', function () {
      var y = Math.max(0, parseInt($('waitY').value, 10) || 0);
      var m = Math.max(0, parseInt($('waitM').value, 10) || 0);
      if (!y && !m) return U.toast('请输入等待时长（年 / 月）');
      U.toast('等待 ' + (y ? y + ' 年 ' : '') + m + ' 个月…');
      jumpTo(addMonths(S.date, y * 12 + m));
    });

    $('tbPlay').addEventListener('click', function () {
      var btn = $('tbPlay');
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
        btn.textContent = '▶ 连续滚动';
        btn.classList.remove('on');
        return;
      }
      var cal = E.calendar();
      if (S.date >= cal[cal.length - 1]) return U.toast('已到最后一个交易日');
      btn.textContent = '⏸ 停止滚动';
      btn.classList.add('on');
      playTimer = setInterval(function () {
        cal = E.calendar();
        if (S.date >= cal[cal.length - 1]) {
          clearInterval(playTimer);
          playTimer = null;
          btn.textContent = '▶ 连续滚动';
          btn.classList.remove('on');
          U.toast('已滚动到最后一个交易日');
          return;
        }
        jumpTo(addMonths(S.date, 1));
      }, 650);
    });

    $('tbGo').addEventListener('click', function () {
      var d = $('tbJump').value;
      if (!d) return U.toast('先选一个日期');
      jumpTo(d);
    });

    $('qty').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doTrade('buy');
    });
    $('qty').addEventListener('input', renderDeal);

    $('drip').addEventListener('change', function () {
      E.setDrip(this.checked);
      U.toast(this.checked ? '分红将按现价自动复投' : '分红将计入现金');
    });

    $('buyBtn').addEventListener('click', function () { doTrade('buy'); });
    $('sellBtn').addEventListener('click', function () { doTrade('sell'); });

    $('tbUndo').addEventListener('click', doUndo);
    $('tbReset').addEventListener('click', function () {
      if (!confirm('清空全部手动买卖，回到复盘起点？自选、红利复投设置和自动策略都不受影响。')) return;
      var r = E.resetManual();
      S = E.session();
      if (!M.stock(state.code)) state.code = S.watch[0];
      $('qty').value = '';
      renderAll();
      U.toast(r.msg);
    });
    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || (e.key !== 'z' && e.key !== 'Z')) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      e.preventDefault();
      doUndo();
    });

    /* 委托到 .dock 上绑定，避免标记结构调整导致事件绑不上 */
    var dock = document.querySelector('.dock');
    dock.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pct]');
      if (!b) return;
      var v = b.getAttribute('data-pct');
      var px = priceOf(state.code);
      if (!px) return U.toast('该时点无行情');
      if (v === 'all-sell') {
        var held = E.shares(state.code) || 0;
        if (!held) return U.toast('当前没有可卖出的持股');
        $('qty').value = held;
        renderDeal();
        return;
      }
      var cash = E.session().cash;
      var max = maxBuyable(state.code, px, cash);
      if (max <= 0) {
        $('qty').value = '';
        renderDeal();
        return U.toast('可用现金不足以买入 1 手');
      }
      var qty = v === '1' ? max : Math.floor(max * Number(v) / lot(state.code)) * lot(state.code);
      $('qty').value = Math.max(qty, 0) || '';
      renderDeal();
    });
  }

  /* 按真实手续费精确计算可买最大股数（逐 lot 回退，避免费率估算不足导致现金不足） */
  function maxBuyable(code, price, cash) {
    var lotN = lot(code);
    var unit = cny(code, price);
    if (unit <= 0 || cash <= 0) return 0;
    var market = M.stock(code).market;
    var rate = market === 'A' ? 0.0004 : 0.0015;   /* A 股买≈0.026%+最低佣；港股买≈0.135%+最低佣 */
    var qty = Math.floor(cash / (unit * (1 + rate)) / lotN) * lotN;
    while (qty > 0) {
      var fee = E.fees(code, qty, price, 'buy', S.date);
      if (cash + 1e-6 >= qty * unit + fee.cny) break;
      qty -= lotN;
    }
    return Math.max(qty, 0);
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
    var r;
    try {
      r = E.trade(state.code, side, qty);
    } catch (err) {
      U.toast('交易失败：' + (err && err.message ? err.message : err));
      return;
    }
    U.toast(r.msg);
    if (r.ok) {
      $('qty').value = '';
      renderAll();
    }
  }
})();
