/* 自动策略回测引擎：独立账户，不污染手动会话。
 * 暴露 SB.strategy.run(plan) → { equity: [{d,v}], trades: [...] }
 * plan: {
 *   type: 'dca' | 'value',
 *   start: 'YYYY-MM-DD',         // 开始日期（通常 = S.startDate）
 *   end:   'YYYY-MM-DD',         // 结束日期（通常 = S.date）
 *   capital: 2000000,            // 初始本金
 *   codes: ['600036','600519'],  // 标的池
 *   // DCA 参数
 *   dcaPeriod: 'month',         // 'week' | 'month' | 'quarter'
 *   dcaAmount: 20000,           // 每期总金额
 *   // 价值触发参数
 *   valMetric: 'pb',            // 'pb' | 'pe'
 *   valBuy: 1.0,                // 买入阈值
 *   valAmount: 50000,           // 每次触发时该标的买入金额
 *   valSell: null,              // 止盈阈值（PB 或 PE ≥ 此值时卖出全部），null=只买不卖
 *   name: '我的定投',           // 曲线名
 *   color: '#B07A2E'            // 曲线色
 * }
 */
(function (global) {
  var M = global.SB.market;

  function lotOf(code) {
    return (M.stock(code) || {}).market === 'HK' ? 100 : 100;
  }
  function fxFor(cur, date) { return M.toCNY(1, cur, date); }
  function fees(code, qty, price, side, date) {
    var st = M.stock(code);
    var amtCur = qty * price;
    var amtCNY = amtCur * fxFor(st.currency, date);
    var broker = Math.max(amtCNY * 0.00025, 5);
    var stamp = side === 'sell' ? amtCNY * 0.001 : 0;
    var transfer = amtCNY * 0.00002;
    return { cny: broker + stamp + transfer };
  }

  function dayDiff(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }
  function snapNextFridayOrFirst(date, kind) {
    // 返回 >= date 的下一个「周几/月初/季度初」
    var d = new Date(date + 'T00:00:00Z');
    if (kind === 'week') {
      // 下一个星期一（避免每日期末不稳定）
      while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    } else if (kind === 'month') {
      d.setUTCDate(1);
      if (d.toISOString().slice(0, 10) < date) {
        d.setUTCMonth(d.getUTCMonth() + 1);
        d.setUTCDate(1);
      }
    } else {
      var m = d.getUTCMonth();
      var q = Math.floor(m / 3) * 3;
      d.setUTCMonth(q); d.setUTCDate(1);
      if (d.toISOString().slice(0, 10) < date) {
        d.setUTCMonth(q + 3); d.setUTCDate(1);
      }
    }
    return d.toISOString().slice(0, 10);
  }

  function run(plan) {
    var codes = plan.codes.slice();
    var cash = plan.capital;
    var pos = {}; // code → { shares, cost, openedAt }
    var trades = [];
    var equity = [];
    var divs = [];
    var lastBuy = {}; // code → date（避免同一天重复触发）

    // 估值序列（每个 code 一条）
    var vsMap = {};
    codes.forEach(function (c) { vsMap[c] = M.valuationSeries(c, plan.end); });

    // 日历
    var all = M.meta().calendar;
    var cal = all.filter(function (d) { return d >= plan.start && d <= plan.end; });

    // 定投状态
    var nextDca = null;
    if (plan.type === 'dca') {
      nextDca = snapNextFridayOrFirst(plan.start, plan.dcaPeriod);
    }

    function portfolioValue(date) {
      var v = cash;
      codes.forEach(function (c) {
        var p = pos[c];
        if (!p || !p.shares) return;
        var r = M.barAt(c, date);
        if (!r) return;
        v += p.shares * r.close * fxFor(M.stock(c).currency, date);
      });
      return v;
    }

    function tryDiv(date) {
      codes.forEach(function (c) {
        var evs = M.stock(c).events || [];
        evs.forEach(function (ev) {
          if (ev.ex !== date || !ev.dps) return;
          var pos0 = pos[c];
          if (!pos0 || !pos0.shares) return;
          var st = M.stock(c);
          var qty = pos0.shares;
          var grossCur = ev.dps * qty;
          var grossCNY = grossCur * fxFor(st.currency, date);
          var held = dayDiff(pos0.openedAt, date);
          var tax = st.market === 'A' ? (held > 365 ? 0 : held > 30 ? 0.1 : 0.2) : 0;
          var netCNY = grossCNY * (1 - tax);
          cash += Math.max(netCNY, 0);
          divs.push({ date: date, code: c, dps: ev.dps, qty: qty, net: +netCNY.toFixed(2) });
        });
      });
    }

    function doBuy(code, amountCNY, date) {
      var st = M.stock(code);
      var r = M.barAt(code, date);
      if (!r) return;
      var lot = lotOf(code);
      var unit = r.close * fxFor(st.currency, date);
      var qty = Math.floor(amountCNY / unit / 1.0003 / lot) * lot;
      if (qty <= 0) return;
      var fee = fees(code, qty, r.close, 'buy', date);
      var need = qty * unit + fee.cny;
      if (need > cash + 1e-6) {
        qty = Math.floor(cash / unit / 1.0003 / lot) * lot;
        if (qty <= 0) return;
        fee = fees(code, qty, r.close, 'buy', date);
        need = qty * unit + fee.cny;
      }
      cash -= need;
      var p = pos[code] || { shares: 0, cost: 0, openedAt: date };
      p.shares += qty;
      p.cost += need;
      if (!p.openedAt) p.openedAt = date;
      pos[code] = p;
      trades.push({ date: date, code: code, name: st.name, side: 'buy', qty: qty, price: +r.close.toFixed(3), amount: +(qty * unit).toFixed(2), fee: +fee.cny.toFixed(2) });
      lastBuy[code] = date;
    }

    function doSellAll(code, date, reason) {
      var p = pos[code];
      if (!p || !p.shares) return;
      var st = M.stock(code);
      var r = M.barAt(code, date);
      if (!r) return;
      var unit = r.close * fxFor(st.currency, date);
      var fee = fees(code, p.shares, r.close, 'sell', date);
      var amt = p.shares * unit - fee.cny;
      cash += amt;
      trades.push({ date: date, code: code, name: st.name, side: 'sell', qty: p.shares, price: +r.close.toFixed(3), amount: +(p.shares * unit).toFixed(2), fee: +fee.cny.toFixed(2), reason: reason });
      pos[code] = null; delete pos[code];
    }

    // 逐日推进
    cal.forEach(function (d) {
      tryDiv(d);

      // 定投触发
      if (plan.type === 'dca' && d >= nextDca) {
        var per = plan.dcaAmount / codes.length;
        codes.forEach(function (c) { doBuy(c, per, d); });
        if (plan.dcaPeriod === 'week') nextDca = snapNextFridayOrFirst(d, 'week');
        else if (plan.dcaPeriod === 'month') nextDca = snapNextFridayOrFirst(d, 'month');
        else nextDca = snapNextFridayOrFirst(d, 'quarter');
      }

      // 估值触发：先检查止盈（若开启），再检查买入
      if (plan.type === 'value') {
        codes.forEach(function (c) {
          var vs = vsMap[c];
          if (!vs || !vs.length) return;
          // 找到 <= d 的最新一条
          // vs 已按日期升序
          var v = null;
          for (var i = vs.length - 1; i >= 0; i--) { if (vs[i].date <= d) { v = vs[i]; break; } }
          if (!v) return;

          var mv = plan.valMetric === 'pe' ? v.pe : v.pb;
          if (mv === null || mv === undefined) return;

          // 卖出
          if (plan.valSell != null && pos[c] && mv >= plan.valSell && pos[c].openedAt !== d) {
            doSellAll(c, d, plan.valMetric.toUpperCase() + ' ≥ ' + plan.valSell);
          }
          // 买入（同一天已触发过的不重复）
          if (mv <= plan.valBuy && lastBuy[c] !== d) {
            doBuy(c, plan.valAmount, d);
          }
        });
      }

      equity.push({ d: d, v: +portfolioValue(d).toFixed(2) });
    });

    return { equity: equity, trades: trades, cash: cash, pos: pos };
  }

  global.SB = global.SB || {};
  global.SB.strategy = { run: run };
})(window);
