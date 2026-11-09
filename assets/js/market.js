/* 真实行情数据层：加载、复权、指标、汇率、财报可见性 */
window.SB = window.SB || {};
SB.market = (function () {
  var meta = null;
  var stocks = {};
  var fxCache = {};

  function loadOne(code) {
    return fetch('data/' + code + '.json', { cache: 'no-cache' }).then(function (r) { return r.json(); });
  }

  function load() {
    return fetch('data/meta.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (m) {
      meta = m;
      var tasks = m.stocks.map(function (s) { return loadOne(s.code); });
      return Promise.all(tasks);
    }).then(function (arr) {
      arr.forEach(function (st) { prepare(st); stocks[st.code] = st; });
      buildFx();
      return true;
    });
  }

  function prepare(st) {
    st.dateIdx = {};
    st.bars.forEach(function (b, i) { st.dateIdx[b[0]] = i; });
    st.firstDate = st.bars.length ? st.bars[0][0] : '';
    st.lastDate = st.bars.length ? st.bars[st.bars.length - 1][0] : '';

    st.eventsByDate = {};
    st.events.forEach(function (ev) {
      (st.eventsByDate[ev.date] = st.eventsByDate[ev.date] || []).push(ev);
    });

    /* 复权因子：乘法累乘，锚定当前时点使用，避免未来事件提前泄露 */
    var n = st.bars.length, cum = new Array(n), acc = 1;
    for (var i = 0; i < n; i++) {
      var evs = st.eventsByDate[st.bars[i][0]];
      if (evs && i > 0) {
        var prev = st.bars[i - 1][4];
        evs.forEach(function (ev) {
          var dps = ev.dps || 0;
          acc *= (prev > 0 ? (prev - dps) / prev : 1) / (ev.factor || 1);
        });
      }
      cum[i] = acc;
    }
    st.cumFac = cum;
  }

  /* 锚定 anchorIdx 的乘法复权因子 */
  function adjFactor(code, idx, anchorIdx) {
    var st = stocks[code];
    var last = st.bars.length - 1;
    var a = anchorIdx === undefined ? last : Math.min(Math.max(anchorIdx, 0), last);
    if (idx >= a) return 1;
    return st.cumFac[a] / st.cumFac[idx];
  }

  function buildFx() {
    var cny = meta.fx.HKDCNY, usd = meta.fx.USDHKD;
    var map = {};
    cny.forEach(function (r) { map[r[0]] = { cny: r[1] }; });
    usd.forEach(function (r) {
      if (!map[r[0]]) map[r[0]] = {};
      map[r[0]].usd = r[1];
    });
    fxCache.map = map;
    fxCache.dates = Object.keys(map).sort();
    fxCache.last = {};
    fxCache.dates.forEach(function (d) {
      fxCache.last[d] = map[d];
      if (map[d].cny === undefined) map[d].cny = fxCache.last[d].cny;
      if (map[d].usd === undefined) map[d].usd = fxCache.last[d].usd;
    });
  }

  function fxRaw(date) {
    var arr = fxCache.dates, lo = 0, hi = arr.length - 1, ans = arr[0];
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] <= date) { ans = arr[mid]; lo = mid + 1; } else { hi = mid - 1; }
    }
    var row = fxCache.map[ans];
    return { cny: row.cny || 0.85, usd: row.usd || 7.8 };
  }

  /* 折算为人民币 */
  function toCNY(amount, cur, date) {
    var fx = fxRaw(date);
    if (cur === 'HKD') return amount * fx.cny;
    if (cur === 'USD') return amount * fx.usd * fx.cny;
    return amount;
  }

  /* 港币折算（分红统一口径） */
  function toHKD(amount, cur, date) {
    if (cur === 'HKD') return amount;
    var fx = fxRaw(date);
    if (cur === 'EUR') return amount * 8.5;
    if (cur === 'USD') return amount * fx.usd;
    return amount / fx.cny;
  }

  /* 任意币种换算（财务报表口径 → 交易币种） */
  function convert(v, from, to, date) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    if (!from || from === to) return v;
    if (to === 'HKD') return toHKD(v, from, date);
    if (to === 'CNY') return toHKD(v, from, date) * fxRaw(date).cny;
    return v;
  }

  function stock(code) { return stocks[code]; }

  /* 最近一根不晚于 date 的 K 线 */
  function barAt(code, date) {
    var st = stocks[code];
    if (!st || !st.bars.length) return null;
    var arr = st.bars, lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid][0] <= date) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (ans < 0) return null;
    return { idx: ans, bar: arr[ans], close: arr[ans][4], date: arr[ans][0] };
  }

  function priceAt(code, date) {
    var r = barAt(code, date);
    return r ? r.close : null;
  }

  function listed(code, date) {
    var st = stocks[code];
    return !!st && st.firstDate && st.firstDate <= date;
  }

  function adjustedClose(code, idx, mode, anchorIdx) {
    var st = stocks[code];
    var raw = st.bars[idx][4];
    if (mode === 'qfq') return raw * adjFactor(code, idx, anchorIdx);
    return raw;
  }

  /* 锚定该日期自身的前复权价 */
  function priceOn(code, date, mode) {
    var r = barAt(code, date);
    if (!r) return null;
    return mode === 'qfq' ? adjustedClose(code, r.idx, 'qfq', r.idx) : r.close;
  }

  function periodKey(date, period) {
    var y = date.slice(0, 4), m = +date.slice(5, 7);
    if (period === 'week') {
      var d = new Date(date + 'T00:00:00Z');
      var day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      return d.toISOString().slice(0, 10);
    }
    if (period === 'month') return y + '-' + (m < 10 ? '0' : '') + m;
    if (period === 'quarter') return y + '-Q' + Math.ceil(m / 3);
    if (period === 'year') return y;
    return date;
  }

  /* bars 截止 endDate（含），复权锚定在 endDate，避免偷看未来 */
  function viewBars(code, period, mode, endDate) {
    var st = stocks[code];
    var endIdx = st.bars.length - 1;
    if (endDate) {
      var r = barAt(code, endDate);
      if (!r) return [];
      endIdx = r.idx;
    }
    var out = [], cur = null;
    for (var i = 0; i <= endIdx; i++) {
      var b = st.bars[i];
      var fac = mode === 'qfq' ? adjFactor(code, i, endIdx) : 1;
      var o = b[1] * fac, h = b[2] * fac, l = b[3] * fac, c = b[4] * fac;
      var k = periodKey(b[0], period);
      if (!cur || cur.key !== k) {
        if (cur) out.push(cur);
        cur = {
          key: k, date: b[0], open: o, close: c, high: h, low: l,
          volume: b[5], startIdx: i, endIdx: i
        };
      } else {
        cur.close = c;
        cur.high = Math.max(cur.high, h);
        cur.low = Math.min(cur.low, l);
        cur.volume += b[5];
        cur.endIdx = i;
        cur.date = b[0];
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function boll(closes, N, K) {
    var mb = [], up = [], dn = [];
    for (var i = 0; i < closes.length; i++) {
      if (i < N - 1) { mb.push(null); up.push(null); dn.push(null); continue; }
      var sum = 0, a;
      for (a = i - N + 1; a <= i; a++) sum += closes[a];
      var mean = sum / N, v = 0;
      for (a = i - N + 1; a <= i; a++) v += Math.pow(closes[a] - mean, 2);
      var sd = Math.sqrt(v / N);
      mb.push(+mean.toFixed(2));
      up.push(+(mean + K * sd).toFixed(2));
      dn.push(+(mean - K * sd).toFixed(2));
    }
    return { mb: mb, up: up, dn: dn };
  }

  function rsi(closes, N) {
    var out = [], gain = 0, loss = 0;
    for (var i = 0; i < closes.length; i++) {
      if (i === 0) { out.push(null); continue; }
      var ch = closes[i] - closes[i - 1];
      var g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= N) { gain += g / N; loss += l / N; }
      else { gain = (gain * (N - 1) + g) / N; loss = (loss * (N - 1) + l) / N; }
      if (i < N) { out.push(null); continue; }
      var rs = loss === 0 ? 100 : gain / loss;
      out.push(+(100 - 100 / (1 + rs)).toFixed(2));
    }
    return out;
  }

  function visibleReports(code, date) {
    var st = stocks[code];
    if (!st) return [];
    return st.reports.filter(function (r) { return r.disc <= date; });
  }

  function latestReport(code, date, annualOnly) {
    var list = visibleReports(code, date);
    for (var i = list.length - 1; i >= 0; i--) {
      if (annualOnly && list[i].date.slice(5) !== '12-31') continue;
      return list[i];
    }
    return null;
  }

  /* 估值指标（当日可见口径） */
  function valuation(code, date) {
    var st = stocks[code];
    var r = barAt(code, date);
    if (!st || !r) return null;
    var price = r.close;
    var reports = visibleReports(code, date);
    var latest = reports[reports.length - 1] || null;
    var annual = latestReport(code, date, true);
    var annualEps = annual ? convert(annual.eps, annual.cur, st.currency, annual.disc) : null;
    var bvps = null;
    for (var bi = reports.length - 1; bi >= 0 && bvps === null; bi--) {
      bvps = convert(reports[bi].bvps, reports[bi].cur, st.currency, reports[bi].disc);
    }
    var ttmEps = null;
    if (reports.length) {
      var cutoff = new Date(date + 'T00:00:00Z');
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
      var cut = cutoff.toISOString().slice(0, 10);
      var sum = 0, cnt = 0;
      reports.forEach(function (x) {
        var v = convert(x.epsQ, x.cur, st.currency, x.disc);
        if (x.date > cut && v !== null && v !== undefined) { sum += v; cnt++; }
      });
      if (cnt >= 2) ttmEps = sum;
    }
    /* 近 12 个月已派股息；若期间无派息，退化为最近一次派息（年付股息避免出现 0 收益率） */
    var dps12 = 0, lastDps = 0, lastDate = '';
    st.events.forEach(function (ev) {
      if (!ev.dps) return;
      var d = new Date(date + 'T00:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      var dCut = d.toISOString().slice(0, 10);
      if (ev.date > dCut && ev.date <= date) {
        dps12 += toHKD(ev.dps, ev.cur || st.currency, ev.date);
      } else if (ev.date <= date && ev.date > lastDate) {
        lastDate = ev.date;
        lastDps = toHKD(ev.dps, ev.cur || st.currency, ev.date);
      }
    });
    if (!dps12) dps12 = lastDps;

    /* 最新报告期同比（A 股为单季，港股为半年度口径） */
    var growth = null;
    if (latest) {
      var ly = String(+latest.date.slice(0, 4) - 1), tail = latest.date.slice(4), yoy = null;
      for (var gi = reports.length - 2; gi >= 0; gi--) {
        if (reports[gi].date.slice(0, 4) === ly && reports[gi].date.slice(4) === tail) {
          yoy = reports[gi];
          break;
        }
      }
      if (yoy) {
        var revNow = convert(latest.revQ, latest.cur, st.currency, latest.disc);
        var revOld = convert(yoy.revQ, yoy.cur, st.currency, yoy.disc);
        var npNow = convert(latest.npQ, latest.cur, st.currency, latest.disc);
        var npOld = convert(yoy.npQ, yoy.cur, st.currency, yoy.disc);
        growth = {
          rev: revNow !== null && revOld > 0 ? revNow / revOld - 1 : null,
          np: npNow !== null && npOld > 0 ? npNow / npOld - 1 : null
        };
      }
    }

    return {
      price: price,
      bvps: bvps,
      annualEps: annualEps,
      ttmEps: ttmEps,
      pb: bvps ? price / bvps : null,
      pe: annualEps ? price / annualEps : null,
      peTtm: ttmEps ? price / ttmEps : null,
      divYield: price ? dps12 / price : null,
      roe: ttmEps !== null && bvps > 0 ? ttmEps / bvps : null,
      growth: growth,
      report: latest
    };
  }

  /* 估值历史分位：按各期财报披露日的价格与当时可见的净资产 / TTM EPS 计算 */
  function valueBand(code, date, years, curPb, curPe) {
    var st = stocks[code];
    if (!st) return null;
    var start = new Date(date + 'T00:00:00Z');
    start.setUTCFullYear(start.getUTCFullYear() - (years || 5));
    var from = start.toISOString().slice(0, 10);
    var all = st.reports.filter(function (r) { return r.disc <= date; });
    var pbArr = [], peArr = [], n = 0;
    all.forEach(function (r, i) {
      if (r.disc < from) return;
      var b = barAt(code, r.disc);
      if (!b) return;
      n++;
      var bv = convert(r.bvps, r.cur, st.currency, r.disc);
      if (bv > 0) pbArr.push(b.close / bv);
      var cut = new Date(r.disc + 'T00:00:00Z');
      cut.setUTCFullYear(cut.getUTCFullYear() - 1);
      var cutStr = cut.toISOString().slice(0, 10), sum = 0, cnt = 0;
      for (var j = i; j >= 0; j--) {
        if (all[j].date <= cutStr) break;
        var q = convert(all[j].epsQ, all[j].cur, st.currency, all[j].disc);
        if (q !== null && q !== undefined) { sum += q; cnt++; }
      }
      if (cnt >= 2 && sum > 0) peArr.push(b.close / sum);
    });
    if (n < 6) return null;
    function rank(arr, v) {
      if (!arr.length || v === null || v === undefined || !isFinite(v) || v <= 0) return null;
      var c = 0;
      for (var k = 0; k < arr.length; k++) if (arr[k] <= v) c++;
      return c / arr.length;
    }
    return {
      pb: rank(pbArr, curPb), pe: rank(peArr, curPe),
      pbN: pbArr.length, peN: peArr.length, n: n
    };
  }

  return {
    load: load,
    meta: function () { return meta; },
    stocks: function () { return stocks; },
    stock: stock,
    barAt: barAt,
    priceAt: priceAt,
    priceOn: priceOn,
    adjustedClose: adjustedClose,
    adjFactor: adjFactor,
    listed: listed,
    viewBars: viewBars,
    boll: boll,
    rsi: rsi,
    visibleReports: visibleReports,
    latestReport: latestReport,
    valuation: valuation,
    valueBand: valueBand,
    toCNY: toCNY,
    toHKD: toHKD,
    convert: convert,
    fxAt: fxRaw,
    periodKey: periodKey
  };
})();
