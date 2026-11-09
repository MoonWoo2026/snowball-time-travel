/* 交易引擎：会话、时间推进、分红拆股、费用、估值 */
window.SB = window.SB || {};
SB.engine = (function () {
  var S = null;
  var M = null;

  function cal() { return M.meta().calendar; }
  function snapIdx(date) {
    var arr = cal(), lo = 0, hi = arr.length - 1, ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] <= date) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  }
  function snapForward(date) {
    var arr = cal(), lo = 0, hi = arr.length - 1, ans = arr.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] >= date) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
    }
    return ans;
  }
  function dayDiff(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }
  function fxFor(cur, date) { return M.toCNY(1, cur, date); }
  function stockCur(code) { return M.stock(code).currency; }
  function lotOf(code) { return M.stock(code).market === 'A' ? 100 : 1; }

  function defaults() {
    var d = M.meta().stocks.filter(function (s) { return s.default; }).map(function (s) { return s.code; });
    return d;
  }

  function create(opts) {
    var startIdx = snapForward(opts.startDate || '2016-11-09');
    var start = cal()[startIdx];
    S = {
      v: 1,
      createdAt: new Date().toISOString(),
      initCash: Math.round((opts.capital || 1800000) / 10000) * 10000,
      cash: Math.round((opts.capital || 1800000) / 10000) * 10000,
      startDate: start,
      date: start,
      watch: (opts.watch && opts.watch.length ? opts.watch.slice() : defaults()),
      initialWatch: (opts.watch && opts.watch.length ? opts.watch.slice() : defaults()),
      pos: {},
      trades: [],
      divs: [],
      equity: [{ d: start, v: Math.round((opts.capital || 1800000) / 10000) * 10000 }],
      drip: true
    };
    save();
    return S;
  }

  function init() { M = SB.market; }

  function load() {
    var raw = SB.store.load();
    if (!raw || raw.v !== 1 || !raw.date) return null;
    S = raw;
    if (!S.pos) S.pos = {};
    if (!S.equity) S.equity = [];
    if (!S.trades) S.trades = [];
    if (!S.divs) S.divs = [];
    S.watch = (S.watch || []).filter(function (c) { return !!M.stock(c); });
    if (!S.watch.length) S.watch = defaults();
    if (!S.initialWatch || !S.initialWatch.length) S.initialWatch = S.watch.slice();
    return S;
  }

  function save() { if (S) SB.store.save(S); }
  function session() { return S; }
  function clear() { S = null; SB.store.clear(); }

  function dateIdx() { return cal().indexOf(S.date); }
  function date() { return S.date; }
  function endDate() { return cal()[cal().length - 1]; }
  function startDate() { return S.startDate; }
  function startIdx() { return cal().indexOf(S.startDate); }

  function position(code) { return S.pos[code] || null; }
  function shares(code) { return S.pos[code] ? S.pos[code].shares : 0; }

  function marketValue(dateStr) {
    var d = dateStr || S.date, total = 0;
    Object.keys(S.pos).forEach(function (code) {
      var p = S.pos[code];
      var price = M.priceAt(code, d);
      if (!p.shares || price === null) return;
      total += p.shares * price * fxFor(stockCur(code), d);
    });
    return total;
  }

  function portfolioValue(dateStr) {
    return S.cash + marketValue(dateStr);
  }

  /* 交易费用（人民币） */
  function fees(code, qty, price, side, dateStr) {
    var st = M.stock(code), amount = qty * price;
    if (st.market === 'A') {
      var commission = Math.max(amount * 0.00025, 5);
      var transfer = amount * 0.00001;
      var stamp = side === 'sell' ? amount * (dateStr >= '2023-08-28' ? 0.0005 : 0.001) : 0;
      return { commission: commission, stamp: stamp, other: transfer, cny: commission + transfer + stamp };
    }
    var hk = Math.max(amount * 0.00025, 3) + amount * 0.001
      + amount * 0.0000565 + amount * 0.000027 + amount * 0.00002;
    return {
      commission: Math.max(amount * 0.00025, 3),
      stamp: amount * 0.001,
      other: amount * (0.0000565 + 0.000027 + 0.00002),
      cny: M.toCNY(hk, 'HKD', dateStr)
    };
  }

  function trade(code, side, qty) {
    var st = M.stock(code);
    if (!st) return { ok: false, msg: '未知标的' };
    qty = Math.floor(qty || 0);
    if (qty <= 0) return { ok: false, msg: '请输入有效股数' };
    if (qty % lotOf(code) !== 0) return { ok: false, msg: 'A 股需为 100 股整数倍' };
    if (!M.listed(code, S.date)) return { ok: false, msg: st.name + ' 在 ' + S.date + ' 尚未上市' };
    var r = M.barAt(code, S.date);
    if (!r) return { ok: false, msg: '当日无行情' };
    var price = r.close;
    var amountCNY = qty * price * fxFor(st.currency, S.date);
    var fee = fees(code, qty, price, side, S.date);

    if (side === 'buy') {
      if (S.cash + 1e-6 < amountCNY + fee.cny) return { ok: false, msg: '现金不足' };
      S.cash -= amountCNY + fee.cny;
      var p = S.pos[code] || { shares: 0, cost: 0, openedAt: S.date };
      p.shares += qty;
      p.cost += amountCNY + fee.cny;
      if (!p.openedAt) p.openedAt = S.date;
      S.pos[code] = p;
    } else {
      var pos = S.pos[code];
      if (!pos || pos.shares < qty) return { ok: false, msg: '持股不足' };
      S.cash += amountCNY - fee.cny;
      pos.cost *= (pos.shares - qty) / pos.shares;
      pos.shares -= qty;
      if (pos.shares <= 0) delete S.pos[code];
    }

    S.trades.push({
      date: S.date, code: code, name: st.name, side: side, qty: qty,
      price: +price.toFixed(3), cur: st.currency,
      fx: +fxFor(st.currency, S.date).toFixed(4),
      fee: +fee.cny.toFixed(2), amount: +amountCNY.toFixed(2)
    });
    updateLastEquity();
    save();
    return { ok: true, msg: (side === 'buy' ? '买入 ' : '卖出 ') + st.name + ' ' + qty + ' 股' };
  }

  function updateLastEquity() {
    var v = +portfolioValue(S.date).toFixed(2);
    var last = S.equity[S.equity.length - 1];
    if (last && last.d === S.date) last.v = v;
    else S.equity.push({ d: S.date, v: v });
  }

  function applyDividend(code, ev, dateStr) {
    var pos = S.pos[code];
    if (!pos || !pos.shares || !ev.dps) return;
    var st = M.stock(code);
    var qty = pos.shares;
    var grossCur = ev.dps * qty;
    var grossCNY = M.toCNY(grossCur, ev.cur || st.currency, dateStr);
    var taxRate = 0;
    if (st.market === 'A') {
      var held = dayDiff(pos.openedAt, dateStr);
      taxRate = held > 365 ? 0 : (held > 30 ? 0.1 : 0.2);
    }
    var taxCNY = grossCNY * taxRate;
    var netCNY = grossCNY - taxCNY;
    var reinvested = 0;
    if (S.drip) {
      var px = M.priceAt(code, dateStr);
      if (px) {
        var unit = px * fxFor(st.currency, dateStr);
        var lot = lotOf(code);
        reinvested = Math.floor(netCNY / unit / lot) * lot;
        if (reinvested > 0) {
          pos.shares += reinvested;
          pos.cost += reinvested * unit;
          netCNY -= reinvested * unit;
        }
      }
    }
    S.cash += Math.max(netCNY, 0);
    S.divs.push({
      date: dateStr, code: code, name: st.name,
      dps: +ev.dps.toFixed(4), qty: qty,
      gross: +grossCNY.toFixed(2), tax: +taxCNY.toFixed(2),
      net: +(grossCNY - taxCNY).toFixed(2), cash: +Math.max(netCNY, 0).toFixed(2),
      shares: reinvested
    });
  }

  function advanceTo(target) {
    if (!S) return;
    var arr = cal();
    var to = snapIdx(target);
    var from = arr.indexOf(S.date);
    if (to <= from) return;
    var codes = Object.keys(S.pos);
    for (var i = from + 1; i <= to; i++) {
      var d = arr[i];
      codes.forEach(function (code) {
        var st = M.stock(code);
        var evs = st.eventsByDate[d];
        if (!evs) return;
        evs.forEach(function (ev) {
          if (ev.dps > 0) applyDividend(code, ev, d);
          if (ev.factor && ev.factor !== 1 && S.pos[code]) {
            S.pos[code].shares = Math.max(1, Math.round(S.pos[code].shares * ev.factor));
          }
        });
      });
      S.equity.push({ d: d, v: +portfolioValue(d).toFixed(2) });
    }
    S.date = arr[to];
    save();
  }

  function metrics() {
    var total = portfolioValue(S.date);
    var ret = total / S.initCash - 1;
    var days = Math.max(1, dayDiff(S.startDate, S.date));
    var cagr = days < 30 ? null : Math.pow(total / S.initCash, 365 / days) - 1;
    var divTotal = S.divs.reduce(function (a, x) { return a + x.net; }, 0);
    var divGross = S.divs.reduce(function (a, x) { return a + x.gross; }, 0);
    return {
      total: total, cash: S.cash, mv: marketValue(S.date),
      ret: ret, cagr: cagr, div: divTotal, divGross: divGross,
      days: days, trades: S.trades.length,
      holdings: Object.keys(S.pos).filter(function (c) { return S.pos[c].shares > 0; }).length
    };
  }

  /* 初始自选等权买入持有基准 */
  function benchmark() {
    var total = 0, n = 0;
    var start = S.startDate, cur = S.date;
    S.initialWatch.forEach(function (code) {
      if (!M.listed(code, start)) return;
      var a = M.barAt(code, start), b = M.barAt(code, cur);
      if (!a || !b) return;
      total += (M.adjustedClose(code, b.idx, 'qfq') / M.adjustedClose(code, a.idx, 'qfq')) - 1;
      n++;
    });
    if (!n) return S.initCash;
    return S.initCash * (1 + total / n);
  }

  function addWatch(code) {
    if (!M.stock(code)) return { ok: false, msg: '未知标的' };
    if (S.watch.indexOf(code) < 0) { S.watch.push(code); save(); }
    return { ok: true };
  }
  function removeWatch(code) {
    if (S.pos[code] && S.pos[code].shares > 0) return { ok: false, msg: '仍有持仓，无法移出自选' };
    S.watch = S.watch.filter(function (c) { return c !== code; });
    save();
    return { ok: true };
  }

  function setDrip(v) { S.drip = !!v; save(); }

  return {
    init: init, create: create, load: load, save: save, session: session, clear: clear,
    date: date, dateIdx: dateIdx, startDate: startDate, startIdx: startIdx, endDate: endDate,
    calendar: cal, equity: function () { return S.equity; },
    trades: function () { return S.trades; }, dividends: function () { return S.divs; },
    watch: function () { return S.watch.slice(); },
    position: position, shares: shares, marketValue: marketValue, portfolioValue: portfolioValue,
    trade: trade, advanceTo: advanceTo, metrics: metrics, benchmark: benchmark,
    addWatch: addWatch, removeWatch: removeWatch, setDrip: setDrip,
    fees: fees, snapIdx: snapIdx, dayDiff: dayDiff
  };
})();
