/* 自动策略回测引擎：独立账户，不污染手动会话。
 * 暴露 SB.strategy.run(plan) → { equity: [{d,v}], trades: [...] }
 * plan: {
 *   type: 'dca' | 'value',
 *   start: 'YYYY-MM-DD',
 *   end:   'YYYY-MM-DD',
 *   capital: 2000000,
 *   codes: ['600036','600519'],
 *   // DCA 参数
 *   dcaPeriod: 'week' | 'month' | 'quarter',
 *   dcaAmount: 20000,
 *   rebalPeriod: null | 'month' | 'quarter' | 'year',  // 定期再平衡
 *   // 价值触发参数
 *   valMetric: 'pb' | 'pe',
 *   valBuy: 1.0,
 *   valAmount: 50000,
 *   valSell: null,  // 估值止盈阈值（≥ 则清仓）
 *   // 卖出通用参数（两种策略都用）
 *   tpPct: 0.30,           // 目标收益率止盈（30%），null/0=关闭
 *   tpMode: 'full'|'part', // 一次性全清 / 分批（1/3 起步）
 *   tpTiers: [0.2, 0.4, 0.6], // 分批的各档触发点
 *   slPct: null,           // 止损（浮亏 ≥ X 清仓），null=关闭
 *   holdDays: null,        // 持有期到期强制清仓天数
 *   name: '我的定投',
 *   color: '#B07A2E'
 * }
 */
(function (global) {
  var M = global.SB.market;

  function lotOf(code) {
    return 100;
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
    return Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
  }
  function snapNextFridayOrFirst(date, kind) {
    var d = new Date(date + 'T00:00:00Z');
    if (kind === 'week') {
      while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    } else if (kind === 'month') {
      d.setUTCDate(1);
      if (d.toISOString().slice(0, 10) < date) {
        d.setUTCMonth(d.getUTCMonth() + 1);
        d.setUTCDate(1);
      }
    } else if (kind === 'quarter') {
      var m = d.getUTCMonth();
      var q = Math.floor(m / 3) * 3;
      d.setUTCMonth(q); d.setUTCDate(1);
      if (d.toISOString().slice(0, 10) < date) {
        d.setUTCMonth(q + 3); d.setUTCDate(1);
      }
    } else if (kind === 'year') {
      d = new Date(date + 'T00:00:00Z');
      d.setUTCMonth(0); d.setUTCDate(1);
      if (d.toISOString().slice(0, 10) < date) d.setUTCFullYear(d.getUTCFullYear() + 1);
    }
    return d.toISOString().slice(0, 10);
  }

  function run(plan) {
    var codes = plan.codes.slice();
    var cash = plan.capital;
    var pos = {}; // code → { shares, cost, openedAt, tpTier:0 }
    var trades = [];
    var equity = [];
    var divs = [];
    var lastBuy = {};

    // 估值序列
    var vsMap = {};
    codes.forEach(function (c) { vsMap[c] = M.valuationSeries(c, plan.end); });

    var all = M.meta().calendar;
    var cal = all.filter(function (d) { return d >= plan.start && d <= plan.end; });

    var nextDca = null, nextRebal = null;
    if (plan.type === 'dca') {
      nextDca = snapNextFridayOrFirst(plan.start, plan.dcaPeriod);
      if (plan.rebalPeriod) nextRebal = snapNextFridayOrFirst(plan.start, plan.rebalPeriod);
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

    function priceOf(code, date) {
      var r = M.barAt(code, date);
      if (!r) return null;
      return r.close * fxFor(M.stock(code).currency, date);
    }

    function unrealizedPct(code, date) {
      var p = pos[code];
      if (!p || !p.shares) return null;
      var unit = priceOf(code, date);
      if (!unit) return null;
      var marketVal = p.shares * unit;
      var avgCost = p.cost / p.shares;
      return unit / avgCost - 1; // 浮盈率
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
      var p = pos[code] || { shares: 0, cost: 0, openedAt: date, tpTier: 0 };
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

    function doSellPart(code, ratio, date, reason) {
      var p = pos[code];
      if (!p || !p.shares) return;
      var st = M.stock(code);
      var r = M.barAt(code, date);
      if (!r) return;
      var lot = lotOf(code);
      var unit = r.close * fxFor(st.currency, date);
      var qty = Math.floor(p.shares * ratio / lot) * lot;
      if (qty <= 0 || qty >= p.shares) { doSellAll(code, date, reason); return; }
      var fee = fees(code, qty, r.close, 'sell', date);
      var amt = qty * unit - fee.cny;
      cash += amt;
      p.shares -= qty;
      p.cost -= qty * (p.cost / (p.shares + qty)); // 按比例减成本（简化，实际应按移动加权）
      trades.push({ date: date, code: code, name: st.name, side: 'sell', qty: qty, price: +r.close.toFixed(3), amount: +(qty * unit).toFixed(2), fee: +fee.cny.toFixed(2), reason: reason });
      if (p.shares <= 0) { pos[code] = null; delete pos[code]; }
    }

    /* 定期再平衡：把当前持仓卖回到等权 */
    function doRebal(date) {
      // 1) 计算当前总资产下每个 code 应有的目标市值 = 总资产 / codes.length
      // 2) 对超配的先卖出，对低配的后买入（先卖后买避免现金不够）
      var total = portfolioValue(date);
      var targetPer = total / codes.length;
      var sells = [], buys = [];
      codes.forEach(function (c) {
        var p = pos[c];
        var mv = p && p.shares ? p.shares * priceOf(c, date) : 0;
        var diff = mv - targetPer;
        if (diff > targetPer * 0.05 && mv > 0) sells.push({ code: c, ratio: diff / mv });
        else if (diff < -targetPer * 0.05) buys.push({ code: c, amount: -diff });
      });
      sells.forEach(function (s) {
        doSellPart(s.code, s.ratio, date, '再平衡');
      });
      buys.forEach(function (b) {
        doBuy(b.code, b.amount, date);
      });
    }

    /* 通用卖出检查：收益率止盈/止损、持有期到期 */
    function checkGenericSell(code, date) {
      var p = pos[code];
      if (!p || !p.shares) return;

      // 持有期到期
      if (plan.holdDays && dayDiff(p.openedAt, date) >= plan.holdDays) {
        doSellAll(code, date, '持有 ' + plan.holdDays + ' 天到期');
        return;
      }

      var pnl = unrealizedPct(code, date);
      if (pnl === null) return;

      // 止损（优先级高于止盈，先保命）
      if (plan.slPct != null && plan.slPct > 0 && pnl <= -plan.slPct) {
        doSellAll(code, date, '止损 ' + (pnl * 100).toFixed(1) + '% ≤ -' + (plan.slPct * 100).toFixed(0) + '%');
        return;
      }

      // 收益率止盈
      if (plan.tpPct && plan.tpPct > 0 && pnl >= plan.tpPct) {
        if (plan.tpMode === 'part') {
          // 分批：每达到一档再卖 1/3
          var tiers = plan.tpTiers || [plan.tpPct];
          while (p.tpTier < tiers.length && pnl >= tiers[p.tpTier]) {
            doSellPart(code, 1/3, date, '分批止盈 ≥ ' + (tiers[p.tpTier] * 100).toFixed(0) + '%');
            p = pos[code];
            if (!p || !p.shares) return;
            p.tpTier = (p.tpTier || 0) + 1;
          }
          // 如果超过最后一档，一次性清剩余
          if (p && p.tpTier >= tiers.length && pnl >= tiers[tiers.length - 1]) {
            doSellAll(code, date, '分批止盈最后一档 ≥ ' + (tiers[tiers.length - 1] * 100).toFixed(0) + '%');
          }
        } else {
          doSellAll(code, date, '目标收益率止盈 ≥ ' + (plan.tpPct * 100).toFixed(0) + '%');
        }
      }
    }

    // 逐日推进
    cal.forEach(function (d) {
      tryDiv(d);

      // 先检查所有持仓的卖出条件（止损、止盈、持有期）
      codes.forEach(function (c) { checkGenericSell(c, d); });

      // 定期再平衡（定投专属）
      if (plan.type === 'dca' && plan.rebalPeriod && d >= nextRebal) {
        doRebal(d);
        nextRebal = snapNextFridayOrFirst(d, plan.rebalPeriod);
      }

      // 定投触发
      if (plan.type === 'dca' && d >= nextDca) {
        var per = plan.dcaAmount / codes.length;
        codes.forEach(function (c) { doBuy(c, per, d); });
        nextDca = snapNextFridayOrFirst(d, plan.dcaPeriod);
      }

      // 估值触发
      if (plan.type === 'value') {
        codes.forEach(function (c) {
          var vs = vsMap[c];
          if (!vs || !vs.length) return;
          var v = null;
          for (var i = vs.length - 1; i >= 0; i--) { if (vs[i].date <= d) { v = vs[i]; break; } }
          if (!v) return;

          var mv = plan.valMetric === 'pe' ? v.pe : v.pb;
          if (mv === null || mv === undefined) return;

          // 估值止盈（≥ 清仓）
          if (plan.valSell != null && pos[c] && mv >= plan.valSell && pos[c].openedAt !== d) {
            doSellAll(c, d, plan.valMetric.toUpperCase() + ' ≥ ' + plan.valSell);
          }
          // 买入
          if (mv <= plan.valBuy && lastBuy[c] !== d) {
            doBuy(c, plan.valAmount, d);
          }
        });
      }

      equity.push({ d: d, v: +portfolioValue(d).toFixed(2) });
    });

    return { equity: equity, trades: trades, cash: cash, pos: pos, divs: divs };
  }

  global.SB = global.SB || {};
  global.SB.strategy = { run: run };
})(window);
