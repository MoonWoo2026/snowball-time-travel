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
    var rep = replay();
    var dd = maxDrawdown(eq);
    var fees = S.trades.reduce(function (a, t) { return a + t.fee; }, 0);

    $('kpis').innerHTML = [
      ['期末总资产', U.money(m.total), S.date, null],
      ['<span class="term" data-term="total_ret">累计收益<span class="info-i">ⓘ</span></span>', U.pct(m.ret), '本金 ' + U.money(S.initCash), 'ret'],
      ['<span class="term" data-term="cagr">年化收益<span class="info-i">ⓘ</span></span>', m.cagr === null ? '--' : U.pct(m.cagr), m.days + ' 天', 'cagr'],
      ['<span class="term" data-term="mdd">最大回撤<span class="info-i">ⓘ</span></span>', (Math.abs(dd) * 100).toFixed(2) + '%', '按日资产曲线', 'dd'],
      ['累计分红', U.money(m.div), '税后 ' + S.divs.length + ' 笔', null]
    ].map(function (k) {
      var color = k[3] === 'ret' ? U.cls(m.ret) : (k[3] === 'cagr' ? U.cls(m.cagr || 0) : (k[3] === 'dd' && dd < 0 ? 'down' : ''));
      return '<div class="kpi"><span>' + k[0] + '</span><b class="' + color + '">' + k[1] + '</b><em>' + k[2] + '</em></div>';
    }).join('');

    renderCurve(eq, rep);
    renderStyle(rep);
    renderOps(rep);
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
    $('openStrat').onclick = openStratDialog;
  }

  var KIND = { open: '建仓', add: '加仓', cut: '减仓', close: '清仓' };
  var STRATS = []; // 已添加的自动策略 [{plan, result}]
  var CURVE_COLORS = ['#6B8FB8', '#8B6E5A', '#4A8F6A', '#A57989']; // 蓝、棕、绿、粉（避开深蓝#1E3A5F和铜金#B07A2E）

  function days(a, b) {
    return Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));
  }

  function stratEquity(plan) {
    // 把 strategy 的 equity 对齐到用户曲线的交易日列表
    var r = SB.strategy.run(plan);
    var idx = {};
    r.equity.forEach(function (p, i) { idx[p.d] = i; });
    var out = [];
    var last = null;
    S.equity().forEach(function (p) {
      if (idx[p.d] !== undefined) last = r.equity[idx[p.d]].v;
      out.push(last === null ? null : last);
    });
    return out;
  }

  /* 回放成交：区分建仓/加仓/减仓/清仓，并按移动加权成本算出每笔已实现盈亏 */
  function replay() {
    var hold = {}, events = [], rounds = [];
    S.trades.forEach(function (t) {
      var s = hold[t.code] || (hold[t.code] = { shares: 0, cost: 0, open: null, pnl: 0 });
      var before = s.shares, kind, realized = 0;
      if (t.side === 'buy') {
        if (before === 0) { kind = 'open'; s.open = t.date; s.pnl = 0; }
        else kind = 'add';
        s.shares += t.qty;
        s.cost += t.amount + t.fee;
      } else {
        var avg = s.shares ? s.cost / s.shares : 0;
        realized = (t.amount - t.fee) - avg * t.qty;
        s.pnl += realized;
        kind = (before - t.qty <= 0) ? 'close' : 'cut';
        s.cost -= avg * t.qty;
        s.shares -= t.qty;
        if (kind === 'close') {
          rounds.push({ code: t.code, name: t.name, open: s.open, close: t.date, pnl: s.pnl });
          s.pnl = 0;
          s.open = null;
        }
      }
      events.push({
        date: t.date, code: t.code, name: t.name, side: t.side, kind: kind,
        qty: t.qty, amount: t.amount, price: t.price, cur: t.cur,
        fx: t.fx, realized: realized, sharesAfter: s.shares
      });
    });
    return { events: events, rounds: rounds };
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

  function renderCurve(eq, rep) {
    if (!eq.length) return;
    var pts = eq;
    var cats = pts.map(function (x) { return x.d; });
    var idx = {};
    cats.forEach(function (d, i) { idx[d] = i; });
    var nav = pts.map(function (x) { return x.v; });
    var bench = pts.map(function (x) { return benchAt(x.d); });

    // 策略曲线：动态拼进 series
    var stratSeries = STRATS.slice(0, 4).map(function (s, i) {
      return {
        name: s.plan.name, type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: s.equity, symbol: 'none',
        lineStyle: { width: 1.3, color: CURVE_COLORS[i % CURVE_COLORS.length], type: 'solid' }
      };
    });
    var legendData = ['我的账户', '等权买入持有'].concat(STRATS.slice(0, 4).map(function (s) { return s.plan.name; }))
      .concat(['买卖点', '加仓', '减仓']);

    var flowIn = cats.map(function () { return 0; });
    var flowOut = cats.map(function () { return 0; });
    var marks = [];
    rep.events.forEach(function (e) {
      var i = idx[e.date];
      if (i === undefined) return;
      var up = e.side === 'buy';
      if (up) flowIn[i] += e.amount; else flowOut[i] -= e.amount;
      marks.push({
        value: [e.date, nav[i]],
        name: e.name,
        symbol: 'triangle',
        symbolRotate: up ? 0 : 180,
        symbolSize: (e.kind === 'open' || e.kind === 'close') ? 10 : 7,
        itemStyle: { color: up ? C.up : C.down },
        label: {
          show: true, position: up ? 'bottom' : 'top',
          fontSize: 8.5, color: up ? C.up : C.down,
          formatter: e.name.length > 4 ? e.name.slice(0, 4) : e.name
        },
        ext: e
      });
    });

    $('curveTag').textContent = '基准 ' + U.money(E.benchmark()) +
      ' · 超额 ' + U.pct(E.benchmark() ? E.metrics().total / E.benchmark() - 1 : 0) +
      ' · 全部 ' + eq.length + ' 个交易日 · ' + rep.events.length + ' 个买卖点';

    rvCurve.setOption({
      animation: false,
      grid: [
        { left: 56, right: 16, top: 28, height: '54%' },
        { left: 56, right: 16, top: '73%', height: '15%' }
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true }
      ],
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', borderColor: '#E3DED3',
        textStyle: { color: '#1C2126', fontSize: 11 },
        formatter: function (ps) {
          var s = '<b>' + ps[0].axisValue + '</b>';
          ps.forEach(function (p) {
            if (p.seriesName === '买卖点') {
              var e = p.data && p.data.ext;
              if (!e) return;
              s += '<br>' + p.marker + '<b>' + KIND[e.kind] + '</b> ' + U.esc(e.name) +
                ' · ' + e.qty.toLocaleString('en-US') + ' 股 @ ' + U.px(e.price, e.cur);
              if (e.side === 'sell') s += ' · 实现 <b class="' + U.cls(e.realized) + '">' + U.money(e.realized) + '</b>';
            } else if (p.seriesName === '加仓' || p.seriesName === '减仓') {
              if (!p.value) return;
              s += '<br>' + p.marker + p.seriesName + '：' + U.money(Math.abs(p.value));
            } else if (typeof p.value === 'number') {
              s += '<br>' + p.marker + p.seriesName + '：' + U.money(p.value);
            }
          });
          return s;
        }
      },
      legend: {
        top: 0, right: 0, icon: 'roundRect', itemWidth: 9, itemHeight: 9,
        textStyle: { fontSize: 10, color: C.muted },
        data: legendData
      },
      xAxis: [
        {
          type: 'category', gridIndex: 0, data: cats,
          axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false },
          axisLabel: { show: false }
        },
        {
          type: 'category', gridIndex: 1, data: cats,
          axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false },
          axisLabel: { fontSize: 9, color: C.faint, hideOverlap: true }
        }
      ],
      yAxis: [
        {
          type: 'value', gridIndex: 0, scale: true,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { fontSize: 9, color: C.faint, formatter: function (v) { return (v / 1e4).toFixed(0) + '万'; } },
          splitLine: { lineStyle: { color: C.rule, type: 'dashed' } }
        },
        {
          type: 'value', gridIndex: 1, splitNumber: 2,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { fontSize: 8, color: C.faint, formatter: function (v) { return Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(0) + '万' : ''; } },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: '我的账户', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
          data: nav, symbol: 'none', z: 3,
          lineStyle: { width: 1.8, color: C.accent },
          areaStyle: { color: 'rgba(30,58,95,.06)' }
        },
        {
          name: '等权买入持有', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
          data: bench, symbol: 'none',
          lineStyle: { width: 1.2, color: C.gold, type: 'dashed' }
        }
      ].concat(stratSeries).concat([
        {
          name: '买卖点', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
          data: marks, z: 10,
          labelLayout: { hideOverlap: true }
        },
        {
          name: '加仓', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
          data: flowIn, barMaxWidth: 8, itemStyle: { color: C.up }
        },
        {
          name: '减仓', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
          data: flowOut, barMaxWidth: 8, itemStyle: { color: C.down }
        }
      ])
    }, true);
  }

  function renderStyle(rep) {
    var m = E.metrics();
    var eq = E.equity();
    var years = Math.max(0.08, m.days / 365);

    /* 现金随时间的变化：用于还原股票仓位 */
    var deltas = S.trades.map(function (t) {
      return { d: t.date, v: t.side === 'buy' ? -(t.amount + t.fee) : (t.amount - t.fee) };
    }).concat(S.divs.map(function (d) { return { d: d.date, v: d.net }; }))
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });

    var di = 0, cash = S.initCash;
    var sumAll = 0, nAll = 0, sumPost = 0, nPost = 0;
    var eqMap = {};
    var firstBuy = null;
    rep.events.forEach(function (e) { if (!firstBuy) firstBuy = e.date; });
    eq.forEach(function (p) {
      while (di < deltas.length && deltas[di].d <= p.d) { cash += deltas[di].v; di++; }
      eqMap[p.d] = p.v;
      var sr = p.v > 0 ? 1 - cash / p.v : 0;
      if (sr < 0) sr = 0;
      if (sr > 1) sr = 1;
      sumAll += sr; nAll++;
      if (firstBuy && p.d >= firstBuy) { sumPost += sr; nPost++; }
    });
    var avgStock = nAll ? sumAll / nAll : 0;
    var avgPost = nPost ? sumPost / nPost : avgStock;
    var finalCashRatio = m.total > 0 ? m.cash / m.total : 0;

    /* 最高单票权重：在每次成交日按成交后股数估算 */
    var maxW = 0, maxWName = '';
    rep.events.forEach(function (e) {
      var total = eqMap[e.date];
      if (!total) return;
      var st = M.stock(e.code);
      if (!e.sharesAfter) return;
      var px = M.priceAt(e.code, e.date) || e.price;
      var mv = e.sharesAfter * px * M.toCNY(1, st.currency, e.date);
      if (mv / total > maxW) { maxW = mv / total; maxWName = e.name; }
    });

    var turnover = S.trades.reduce(function (a, t) { return a + t.amount; }, 0);
    var yearTurnover = turnover / years / Math.max(1, (S.initCash + m.total) / 2);

    var wins = rep.rounds.filter(function (r) { return r.pnl > 0; });
    var losses = rep.rounds.filter(function (r) { return r.pnl < 0; });
    var winRate = rep.rounds.length ? wins.length / rep.rounds.length : null;
    var avgWin = wins.length ? wins.reduce(function (a, r) { return a + r.pnl; }, 0) / wins.length : 0;
    var avgLoss = losses.length ? losses.reduce(function (a, r) { return a + r.pnl; }, 0) / losses.length : 0;
    var pf = avgLoss ? Math.abs(avgWin / avgLoss) : (avgWin ? Infinity : null);
    var holdDays = rep.rounds.length
      ? Math.round(rep.rounds.reduce(function (a, r) { return a + days(r.open, r.close); }, 0) / rep.rounds.length)
      : null;

    /* 风格标签 */
    var tags = [];
    if (avgPost >= 0.8) tags.push(['建仓后接近满仓', 'hi']);
    else if (avgPost >= 0.5) tags.push(['建仓后均衡仓位', '']);
    else if (avgPost >= 0.2) tags.push(['轻仓试探', 'warn']);
    else tags.push(['极度耐心·长期持币', 'warn']);

    if (maxW >= 0.4) tags.push(['集中持股', 'hi']);
    else if (maxW >= 0.22) tags.push(['适度分散', '']);
    else tags.push(['高度分散', '']);

    var perYear = S.trades.length / years;
    if (perYear >= 10) tags.push(['高频调仓', 'warn']);
    else if (perYear >= 3) tags.push(['适度交易', '']);
    else tags.push(['低频长期持有', 'hi']);

    if (winRate !== null) {
      if (winRate >= 0.6) tags.push(['胜率偏高', 'hi']);
      else if (winRate <= 0.35) tags.push(['胜率偏低', 'warn']);
    }
    if (pf !== null && pf >= 2) tags.push(['盈亏比优秀', 'hi']);
    if (finalCashRatio >= 0.5) tags.push(['现金尚未部署完', 'warn']);

    var items = [
      ['平均股票仓位', (avgStock * 100).toFixed(1) + '%', '全程'],
      ['建仓后仓位', (avgPost * 100).toFixed(1) + '%', '首次买入起'],
      ['最高单票权重', (maxW * 100).toFixed(1) + '%', maxWName || '--'],
      ['<span class="term" data-term="turnover">年化换手率<span class="info-i">ⓘ</span></span>', (yearTurnover * 100).toFixed(0) + '%', S.trades.length + ' 笔'],
      ['<span class="term" data-term="winrate">已实现胜率<span class="info-i">ⓘ</span></span>', winRate === null ? '--' : (winRate * 100).toFixed(0) + '%', rep.rounds.length + ' 次清仓'],
      ['<span class="term" data-term="pl_ratio">盈亏比<span class="info-i">ⓘ</span></span>', pf === null ? '--' : (pf === Infinity ? '∞' : pf.toFixed(2)), '平均盈利 / 平均亏损'],
      ['平均持有', holdDays === null ? '--' : holdDays + ' 天', '已清仓回合'],
      ['期末现金占比', (finalCashRatio * 100).toFixed(1) + '%', U.money(m.cash)]
    ];

    $('rvStyle').innerHTML =
      '<h3>策略风格总结 <span>' + S.startDate + ' → ' + S.date + ' · ' + years.toFixed(1) + ' 年</span></h3>' +
      '<div class="sty-tags">' + tags.map(function (t) {
        return '<span class="sty-tag ' + t[1] + '">' + t[0] + '</span>';
      }).join('') + '</div>' +
      '<div class="sty-grid">' + items.map(function (it) {
        return '<div class="sty-item"><span>' + it[0] + '</span><b>' + it[1] + '</b>' +
          '<span>' + it[2] + '</span></div>';
      }).join('') + '</div>' +
      '<p class="sty-note">全程股票仓位 <b>' + (avgStock * 100).toFixed(1) + '%</b>，首次买入后平均 <b>' +
      (avgPost * 100).toFixed(1) + '%</b>。共 <b>' + S.trades.length + '</b> 笔成交、覆盖 <b>' +
      Object.keys(rep.events.reduce(function (o, e) { o[e.code] = 1; return o; }, {})).length +
      '</b> 只标的，年化换手约 <b>' + (yearTurnover * 100).toFixed(0) + '%</b>。' +
      (winRate === null ? '尚未产生完整清仓回合，风格判定偏重仓位与节奏。' :
        '已清仓 <b>' + rep.rounds.length + '</b> 次，胜率 <b>' + (winRate * 100).toFixed(0) +
        '%</b>，盈亏比 <b>' + (pf === Infinity ? '∞' : pf.toFixed(2)) + '</b>，平均持有 <b>' +
        holdDays + '</b> 天。') +
      (finalCashRatio >= 0.5 ? ' 期末仍有 <b>' + (finalCashRatio * 100).toFixed(0) + '%</b> 现金未部署，资金效率还有提升空间。' : '') +
      '</p>';
  }

  function valAt(code, date) {
    var vs = M.valuationSeries(code, date);
    if (!vs.length) return null;
    var v = vs[vs.length - 1];
    return v && (v.pe || v.pb) ? v : null;
  }

  /* 主要操作复盘：建仓、清仓必列；加减仓超过当时总资产 5% 才算主要 */
  function renderOps(rep) {
    var eqMap = {};
    E.equity().forEach(function (p) { eqMap[p.d] = p.v; });
    var openAt = {}, invested = {}, roundPnl = {}, majors = [], small = 0;

    rep.events.forEach(function (e) {
      var pv = eqMap[e.date] || 0;
      var w = pv > 0 ? e.amount / pv : 0;
      var major = e.kind === 'open' || e.kind === 'close' || w >= 0.05;
      if (!major) { small++; return; }

      var note = '';
      if (e.kind === 'open') {
        openAt[e.code] = e.date;
        invested[e.code] = e.amount + e.fee;
        roundPnl[e.code] = 0;
        note = '首次建仓，动用当时总资产的 <b>' + (w * 100).toFixed(1) + '%</b>';
        var v = valAt(e.code, e.date);
        if (v) {
          var kv = [];
          if (v.pe) kv.push('PE <b>' + v.pe.toFixed(1) + '</b> 倍');
          if (v.pb) kv.push('PB <b>' + v.pb.toFixed(2) + '</b> 倍');
          if (kv.length) note += '，成交价对应 ' + kv.join('、');
        }
      } else if (e.kind === 'add') {
        invested[e.code] = (invested[e.code] || 0) + e.amount + e.fee;
        note = '加仓至 <b>' + e.sharesAfter.toLocaleString('en-US') + '</b> 股，累计投入 <b>' + U.money(invested[e.code]) + '</b>';
      } else if (e.kind === 'cut') {
        roundPnl[e.code] = (roundPnl[e.code] || 0) + e.realized;
        note = '减仓，回笼 <b>' + U.money(e.amount) + '</b>，剩余 <b>' + e.sharesAfter.toLocaleString('en-US') + '</b> 股';
      } else {
        roundPnl[e.code] = (roundPnl[e.code] || 0) + e.realized;
        var hold = openAt[e.code] ? days(openAt[e.code], e.date) : null;
        var basis = invested[e.code] || (e.amount - e.realized);
        var pct = basis > 0 ? roundPnl[e.code] / basis : 0;
        note = '清仓离场' + (hold ? '，持有 <b>' + hold + '</b> 天' : '') +
          '，累计实现 <b class="' + U.cls(roundPnl[e.code]) + '">' + U.money(roundPnl[e.code]) +
          '</b>（<b class="' + U.cls(pct) + '">' + U.pct(pct) + '</b>）';
        delete openAt[e.code]; delete invested[e.code]; delete roundPnl[e.code];
      }

      majors.push({ e: e, w: w, note: note });
    });

    $('opTag').textContent = majors.length + ' 笔主要操作' +
      (small ? ' · 另有 ' + small + ' 笔小额调仓未列出' : '');
    if (!majors.length) {
      $('opBody').innerHTML = '<div class="empty">期间没有成交记录。</div>';
      return;
    }
    $('opBody').innerHTML = majors.map(function (o) {
      var e = o.e, buy = e.side === 'buy';
      return '<div class="op-row">' +
        '<div class="op-when"><b>' + e.date + '</b><span class="tag' + (buy ? '' : ' sell') + '">' +
          KIND[e.kind] + '</span></div>' +
        '<div class="op-main"><span class="t">' + U.esc(e.name) + '</span>' +
          '<span class="q">' + (buy ? '买入' : '卖出') + ' ' + e.qty.toLocaleString('en-US') +
          ' 股 @ ' + U.px(e.price, e.cur) + '</span>' +
          '<div class="op-note">' + o.note + '</div></div>' +
        '<div class="op-amt">' + U.money(e.amount) + '</div>' +
      '</div>';
    }).join('');
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

  /* ============ 自动策略管理器 ============ */

  function renderStratList() {
    var el = $('stratList');
    if (!STRATS.length) { el.innerHTML = ''; return; }
    el.innerHTML = STRATS.map(function (s, i) {
      var r = s.result;
      var ret = r.equity.length ? (r.equity[r.equity.length - 1].v / s.plan.capital - 1) : 0;
      var cagr = days(s.plan.start, s.plan.end) > 30 ? Math.pow(1 + ret, 365 / days(s.plan.start, s.plan.end)) - 1 : null;
      return '<div class="strat-chip" style="border-color:' + CURVE_COLORS[i % CURVE_COLORS.length] + '">' +
        '<span class="sw" style="background:' + CURVE_COLORS[i % CURVE_COLORS.length] + '"></span>' +
        '<span class="sn">' + s.plan.name + '</span>' +
        '<span class="sr">' + U.pct(ret) + (cagr === null ? '' : ' · 年化 ' + U.pct(cagr)) + '</span>' +
        '<button data-ri="' + i + '" class="sx">×</button>' +
        '</div>';
    }).join('');
    el.querySelectorAll('.sx').forEach(function (b) {
      b.onclick = function () {
        STRATS.splice(+b.getAttribute('data-ri'), 1);
        renderStratList();
        renderCurve(E.equity(), replay());
      };
    });
  }

  function openStratDialog() {
    if (STRATS.length >= 4) { U.toast('最多叠加 4 条策略'); return; }
    var mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML =
      '<div class="modal strat-modal">' +
        '<h4>添加自动策略</h4>' +
        '<label>策略类型' +
          '<div class="seg" id="stType">' +
            '<button data-t="dca" class="on">等权定投</button>' +
            '<button data-t="value">估值触发</button>' +
          '</div>' +
        '</label>' +
        '<div class="s-row"><label>曲线名 <input id="stName" value="定投 每月 ¥2 万" placeholder="比如 每月定投 2 万"></label></div>' +
        '<div class="s-row st-dca">' +
          '<label>周期' +
            '<select id="stPeriod">' +
              '<option value="week">每周</option>' +
              '<option value="month" selected>每月</option>' +
              '<option value="quarter">每季度</option>' +
            '</select>' +
          '</label>' +
          '<label>每期总金额（CNY）<input id="stAmount" type="number" value="20000" step="1000"></label>' +
        '</div>' +
        '<div class="s-row st-value" style="display:none">' +
          '<label>估值指标' +
            '<select id="stMetric">' +
              '<option value="pb" selected>PB（市净率）</option>' +
              '<option value="pe">PE(TTM)</option>' +
            '</select>' +
          '</label>' +
          '<label>买入阈值 ≤ <input id="stBuy" type="number" value="1.0" step="0.1"></label>' +
          '<label>每次买入金额 <input id="stValAmount" type="number" value="50000" step="1000"></label>' +
          '<label class="thin">止盈阈值（PB/PE ≥）<input id="stSell" type="number" placeholder="留空=只买不卖"></label>' +
        '</div>' +
        '<div class="s-row"><label>初始本金（默认和当前复盘一致）<input id="stCapital" type="number" value="' + S.initCash + '" step="10000"></label></div>' +
        '<p class="s-note">独立账户，和你手动操作完全分开。参数相同、数据相同，这样对比才公平。</p>' +
        '<div class="m-act">' +
          '<button class="btn ghost" id="stCancel">取消</button>' +
          '<button class="btn" id="stAdd">添加</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    function updateVisibility() {
      var t = mask.querySelector('#stType button.on').getAttribute('data-t');
      mask.querySelector('.st-dca').style.display = t === 'dca' ? '' : 'none';
      mask.querySelector('.st-value').style.display = t === 'value' ? '' : 'none';
    }
    mask.querySelectorAll('#stType button').forEach(function (b) {
      b.onclick = function () {
        mask.querySelectorAll('#stType button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        updateVisibility();
      };
    });
    updateVisibility();
    mask.querySelector('#stCancel').onclick = function () { mask.remove(); };
    mask.querySelector('.modal').onclick = function (e) { e.stopPropagation(); };
    mask.onclick = function () { mask.remove(); };

    mask.querySelector('#stAdd').onclick = function () {
      var t = mask.querySelector('#stType button.on').getAttribute('data-t');
      var plan = {
        type: t,
        start: S.startDate,
        end: S.date,
        capital: +mask.querySelector('#stCapital').value || S.initCash,
        codes: S.watch.slice(),
        name: mask.querySelector('#stName').value.trim() || (t === 'dca' ? '等权定投' : '估值触发')
      };
      if (t === 'dca') {
        plan.dcaPeriod = mask.querySelector('#stPeriod').value;
        plan.dcaAmount = +mask.querySelector('#stAmount').value || 10000;
        // 自动填好名
        if (!STRATS.length) mask.querySelector('#stName').value = plan.name = plan.dcaPeriod === 'week' ? '每周定投 ¥' + plan.dcaAmount.toLocaleString() : plan.dcaPeriod === 'month' ? '每月定投 ¥' + plan.dcaAmount.toLocaleString() : '每季度定投 ¥' + plan.dcaAmount.toLocaleString();
      } else {
        plan.valMetric = mask.querySelector('#stMetric').value;
        plan.valBuy = +mask.querySelector('#stBuy').value || 1;
        plan.valAmount = +mask.querySelector('#stValAmount').value || 20000;
        var sv = mask.querySelector('#stSell').value;
        plan.valSell = sv ? +sv : null;
      }
      try {
        var r = SB.strategy.run(plan);
        var eq = stratEquity(plan);
        STRATS.push({ plan: plan, result: r, equity: eq });
        renderStratList();
        renderCurve(E.equity(), replay());
        mask.remove();
      } catch (e) {
        U.toast('策略运行失败：' + e.message);
      }
    };
  }

})();
