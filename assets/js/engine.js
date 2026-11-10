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
      initCash: Math.round((opts.capital || 2000000) / 10000) * 10000,
      cash: Math.round((opts.capital || 2000000) / 10000) * 10000,
      startDate: start,
      date: start,
      watch: (opts.watch && opts.watch.length ? opts.watch.slice() : defaults()),
      initialWatch: (opts.watch && opts.watch.length ? opts.watch.slice() : defaults()),
      pos: {},
      trades: [],
      divs: [],
      equity: [{ d: start, v: Math.round((opts.capital || 2000000) / 10000) * 10000 }],
      drip: true
    };
    save();
    return S;
  }

  function init() { M = SB.market; }

  function load() {
    return adopt(SB.store.load());
  }

  /* 归一化并接管一份会话（当前进度或存档） */
  function adopt(raw) {
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

  /* ---------- 10 档存档 ---------- */
  function slots() { return SB.store.slots(); }
  function saveSlot(i) {
    if (!S) return { ok: false, msg: '还没有进行中的复盘' };
    SB.store.putSlot(i, {
      at: new Date().toISOString(),
      startDate: S.startDate,
      date: S.date,
      initCash: S.initCash,
      total: portfolioValue(S.date),
      ret: portfolioValue(S.date) / S.initCash - 1,
      session: JSON.parse(JSON.stringify(S))
    });
    return { ok: true };
  }
  function loadSlot(i) {
    var item = SB.store.slots()[i];
    if (!item || !item.session) return { ok: false, msg: '该档位没有存档' };
    var s = adopt(JSON.parse(JSON.stringify(item.session)));
    if (!s) return { ok: false, msg: '存档已损坏' };
    save();
    return { ok: true, msg: '已读取第 ' + (i + 1) + ' 档存档' };
  }
  function dropSlot(i) { SB.store.dropSlot(i); }
  function reset() { S = null; SB.store.clear(); }

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

  /* ---------- 手动操作撤销 ---------- */
  var UNDO_MAX = 20;

  /* 每笔手动交易前留一份财务快照：现金、持仓、成交、分红、净值长度 */
  function snapFin() {
    return {
      date: S.date,
      cash: S.cash,
      pos: JSON.parse(JSON.stringify(S.pos)),
      trades: JSON.parse(JSON.stringify(S.trades)),
      divs: JSON.parse(JSON.stringify(S.divs)),
      eqLen: S.equity.length
    };
  }

  function undoCount() { return (S && S._undo) ? S._undo.length : 0; }

  function undoTrade() {
    if (!S) return { ok: false, msg: '没有进行中的复盘' };
    if (!S._undo || !S._undo.length) return { ok: false, msg: '没有可撤销的手动交易' };
    var s = S._undo.pop();
    var cur = S.date;
    var t = S.trades.length ? S.trades[S.trades.length - 1] : null;
    var msg = t ? '已撤销：' + (t.side === 'buy' ? '买入 ' : '卖出 ') + t.name + ' ' + t.qty + ' 股（' + t.date + '）' : '已撤销上一笔交易';

    S.cash = s.cash;
    S.pos = s.pos;
    S.trades = s.trades;
    S.divs = s.divs;
    S.equity = S.equity.slice(0, s.eqLen);
    S.date = s.date;
    updateLastEquity();
    if (cur !== s.date) advanceTo(cur); // 重放之后的行情与分红，时间不倒退
    save();
    return { ok: true, msg: msg };
  }

  /* 清空全部手动操作，回到复盘起点；自选、红利复投设置、自动策略预设都保留 */
  function resetManual() {
    if (!S) return { ok: false, msg: '没有进行中的复盘' };
    S.cash = S.initCash;
    S.pos = {};
    S.trades = [];
    S.divs = [];
    S.equity = [{ d: S.startDate, v: S.initCash }];
    S.date = S.startDate;
    S._undo = [];
    save();
    return { ok: true, msg: '已清空手动操作，回到 ' + S.startDate };
  }

  function trade(code, side, qty) {
    var st = M.stock(code);
    if (!st) return { ok: false, msg: '未知标的' };
    qty = Math.floor(qty || 0);
    if (qty <= 0) return { ok: false, msg: '请输入有效股数' };
    var pos0 = S.pos[code];
    var fullSell = side === 'sell' && pos0 && qty === pos0.shares;
    if (qty % lotOf(code) !== 0 && !fullSell) return { ok: false, msg: 'A 股需为 100 股整数倍' };
    if (!M.listed(code, S.date)) return { ok: false, msg: st.name + ' 在 ' + S.date + ' 尚未上市' };
    var r = M.barAt(code, S.date);
    if (!r) return { ok: false, msg: '当日无行情' };
    var price = r.close;
    var amountCNY = qty * price * fxFor(st.currency, S.date);
    var fee = fees(code, qty, price, side, S.date);

    /* 先做资金/持仓校验，失败不留撤销快照 */
    if (side === 'buy') {
      if (S.cash + 1e-6 < amountCNY + fee.cny) return { ok: false, msg: '现金不足' };
    } else if (!S.pos[code] || S.pos[code].shares < qty) {
      return { ok: false, msg: '持股不足' };
    }

    if (!S._undo) S._undo = [];
    S._undo.push(snapFin());
    if (S._undo.length > UNDO_MAX) S._undo.shift();

    if (side === 'buy') {
      S.cash -= amountCNY + fee.cny;
      var p = S.pos[code] || { shares: 0, cost: 0, openedAt: S.date };
      p.shares += qty;
      p.cost += amountCNY + fee.cny;
      if (!p.openedAt) p.openedAt = S.date;
      S.pos[code] = p;
    } else {
      var pos = S.pos[code];
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

  function firstBuyDate() {
    for (var i = 0; i < S.trades.length; i++) {
      if (S.trades[i].side === 'buy') return S.trades[i].date;
    }
    return null;
  }

  /* 取某日（含）之后第一条净值记录，用于「从首次买入算」的基准 */
  function valueAt(dateStr) {
    for (var i = 0; i < S.equity.length; i++) {
      if (S.equity[i].d >= dateStr) return S.equity[i].v;
    }
    return null;
  }

  function metrics() {
    var total = portfolioValue(S.date);
    var ret = total / S.initCash - 1;
    var days = Math.max(1, dayDiff(S.startDate, S.date));
    var cagr = days < 30 ? null : Math.pow(total / S.initCash, 365 / days) - 1;
    var divTotal = S.divs.reduce(function (a, x) { return a + x.net; }, 0);
    var divGross = S.divs.reduce(function (a, x) { return a + x.gross; }, 0);

    /* 从首次买入日算：基准为该日收盘时的组合总资产，等待期不计入分母与时间 */
    var fb = firstBuyDate(), buy = null;
    if (fb) {
      var base = valueAt(fb);
      if (base && base > 0) {
        var bd = Math.max(1, dayDiff(fb, S.date));
        buy = {
          from: fb, base: base, days: bd,
          ret: total / base - 1,
          cagr: bd < 30 ? null : Math.pow(total / base, 365 / bd) - 1
        };
      }
    }

    return {
      total: total, cash: S.cash, mv: marketValue(S.date),
      ret: ret, cagr: cagr, div: divTotal, divGross: divGross,
      days: days, trades: S.trades.length, firstBuy: fb, buy: buy,
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
    trade: trade, advanceTo: advanceTo, undoCount: undoCount, undoTrade: undoTrade, resetManual: resetManual, metrics: metrics, benchmark: benchmark,
    addWatch: addWatch, removeWatch: removeWatch, setDrip: setDrip,
    slots: slots, saveSlot: saveSlot, loadSlot: loadSlot, dropSlot: dropSlot, reset: reset,
    fees: fees, snapIdx: snapIdx, dayDiff: dayDiff
  };
})();
