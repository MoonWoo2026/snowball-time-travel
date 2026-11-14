/* 周期工具：荀玉根改良美林时钟 + 周金涛周期罗盘
 * 按复盘时点回溯：只使用该日期之前「已公布」的月度宏观数据，不做后视镜结论。 */
window.SB = window.SB || {};
SB.cycle = (function () {
  'use strict';
  var U = SB.ui;
  var data = null, loading = null;
  var last = null;               /* { asOf, res } 最近一次推导结果 */

  function $(id) { return document.getElementById(id); }

  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch('data/macro.json').then(function (r) {
      if (!r.ok) throw new Error('macro.json ' + r.status);
      return r.json();
    }).then(function (d) { data = d; return d; });
    return loading;
  }

  /* ---------- 数值工具 ---------- */
  function r2(x) { return Math.round(x * 100) / 100; }
  function mi(ym) { return parseInt(ym.slice(0, 4), 10) * 12 + parseInt(ym.slice(5, 7), 10) - 1; }
  function yrFrac(d) { return parseInt(d.slice(0, 4), 10) + (parseInt(d.slice(5, 7), 10) - 1) / 12; }
  function lastV(s) { return s.length ? s[s.length - 1].v : null; }
  function lastD(s) { return s.length ? s[s.length - 1].d : '—'; }

  function ser(key, asOf) {
    var arr = (data.series && data.series[key]) || [], out = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i][2] <= asOf) out.push({ d: arr[i][0], v: arr[i][1] });
    }
    return out;
  }

  function zip(a, b, f) {
    var mb = {}, out = [];
    b.forEach(function (x) { mb[x.d] = x.v; });
    a.forEach(function (x) {
      if (mb[x.d] !== undefined) out.push({ d: x.d, v: r2(f(x.v, mb[x.d])), a: x.v, b: mb[x.d] });
    });
    return out;
  }

  function smooth(s, k) {
    k = k || 3;
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var seg = s.slice(Math.max(0, i - k + 1), i + 1), sum = 0;
      seg.forEach(function (x) { sum += x.v; });
      out.push({ d: s[i].d, v: r2(sum / seg.length) });
    }
    return out;
  }

  function chg(s, n) {
    if (s.length <= n) return null;
    return r2(s[s.length - 1].v - s[s.length - 1 - n].v);
  }

  function dir(x, tol) {
    if (x === null || x === undefined) return 'flat';
    tol = tol === undefined ? 0.1 : tol;
    if (x > tol) return 'up';
    if (x < -tol) return 'down';
    return 'flat';
  }

  function f1(v, suffix) {
    return v === null || v === undefined ? '—' : v.toFixed(1) + (suffix || '');
  }

  /* ---------- 荀玉根 · 七段 ---------- */
  var STAGES = {
    1: { name: '衰退前期', g: '↓', i: '↓', n: '未降', asset: '债券', rank: '债券 > 现金 > 股票 > 商品',
         tag: '债券牛启动 · 防守', note: '增长与通胀同步回落、政策尚未转向；债券牛市启动，股票仍在熊市末段' },
    2: { name: '衰退后期', g: '↓', i: '↓', n: '↓', asset: '债券 / 股票（左侧）', rank: '债券 ≈ 股票（左侧布局）> 现金 > 商品',
         tag: '政策底 · 左侧布局', note: '政策加码降息，股票牛市在政策底启动；债券牛延续到通胀回升前' },
    3: { name: '复苏前期', g: '↑', i: '↓', n: '未升', asset: '股票', rank: '股票 > 债券 > 现金 > 商品',
         tag: '股牛主升 · 顺势', note: '政策见效、经济复苏而通胀未起；债券牛进入尾声，股票牛主升' },
    4: { name: '复苏后期', g: '↑', i: '↑', n: '未升', asset: '股票', rank: '股票 > 商品（起步）> 现金 > 债券',
         tag: '股牛后半场 · 持股', note: '实际利率见顶回落，复苏进入下半场；债券牛结束，商品开始蠢动' },
    5: { name: '过热', g: '↑', i: '↑', n: '↑', asset: '商品', rank: '商品 > 现金 > 股票 > 债券',
         tag: '商品牛 · 止盈权益', note: '政策转向收紧；股票牛见经济顶结束，商品牛主升' },
    6: { name: '滞胀前期', g: '↓', i: '↑', n: '↑', asset: '商品 / 现金', rank: '商品 > 现金 > 债券 > 股票',
         tag: '商品牛末段 · 转现金', note: '通胀快速上行、实际利率先降；商品牛仍有惯性，现金牛开始启动' },
    7: { name: '滞胀后期', g: '↓', i: '↑', n: '↑', asset: '现金', rank: '现金 > 债券 > 商品 > 股票',
         tag: '现金为王 · 防守', note: '通胀上行斜率放缓、实际利率见底回升；商品牛结束，现金为王' }
  };
  var CLOCK_ANGLE = { 5: 45, 6: 112.5, 7: 157.5, 1: 202.5, 2: 247.5, 3: 292.5, 4: 337.5 };

  /* ---------- 周金涛 · 基钦 ---------- */
  var PH = {
    recession: { name: '衰退期', sub: '主动去库存', order: 0 },
    depression: { name: '萧条期', sub: '被动去库存', order: 1 },
    recovery: { name: '复苏期', sub: '主动补库存', order: 2 },
    overheat: { name: '过热期', sub: '被动补库存', order: 3 }
  };
  var ALLOC = {
    recession: { tag: '避险离场 · 防守区', rank: '长债 > 现金 > 股票 / 大宗商品',
                 note: '需求坍塌、盈利与估值双杀，等 PPI 见底与库存出清' },
    depression: { tag: '黄金建仓 · 重仓区', rank: '股票（早周期 / 龙头）> 大宗商品 > 现金 > 债券',
                  note: '股价与商品价格先于库存见底，估值触底等右侧验证' },
    recovery: { tag: '主升浪 · 顺势持股区', rank: '股票（强周期 / 核心制造）≈ 大宗商品 > 现金 > 债券',
                note: '量价齐升、业绩与股价戴维斯双击' },
    overheat: { tag: '分批止盈 · 防守区', rank: '现金 / 高股息 > 债券 > 权益 / 大宗商品',
                note: '警惕业绩靓丽但股价滞涨，库存见顶即主动去库起点' }
  };
  var KITCHIN = [['衰退期', '主动去库存'], ['萧条期', '被动去库存'], ['复苏期', '主动补库存'], ['过热期', '被动补库存']];

  function phaseOf(pc, ic) {
    if (pc === null || ic === null) return null;
    var pu = pc > 0.1, iu = ic > 0.1;
    if (iu && pu) return 'recovery';
    if (iu && !pu) return 'overheat';
    if (!iu && pu) return 'depression';
    return 'recession';
  }

  function phaseHist(ppi, inv, months) {
    var pm = {}, im = {}, sp = {}, si = {};
    ppi.forEach(function (x) { pm[x.d] = x.v; });
    inv.forEach(function (x) { im[x.d] = x.v; });
    smooth(ppi).forEach(function (x) { sp[x.d] = x.v; });
    smooth(inv).forEach(function (x) { si[x.d] = x.v; });
    var keys = Object.keys(pm).filter(function (k) { return im[k] !== undefined && sp[k] !== undefined && si[k] !== undefined; }).sort();
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (i < 6) continue;
      var d = keys[i], p6 = keys[i - 6];
      var pc = r2(sp[d] - sp[p6]), ic = r2(si[d] - si[p6]);
      var ph = phaseOf(pc, ic);
      if (ph) out.push({ d: d, phase: ph, ppi: pm[d], inv: im[d], pc: pc, ic: ic });
    }
    return out.slice(-(months || 36));
  }

  /* ---------- 主计算 ---------- */
  function compute(asOf) {
    var S = {
      cpi: ser('cpi', asOf), ppi: ser('ppi', asOf), ip: ser('ip', asOf), pmi: ser('pmi', asOf),
      retail: ser('retail', asOf), fai: ser('fai', asOf), loan: ser('loan', asOf),
      m1: ser('m1', asOf), m2: ser('m2', asOf), house: ser('house', asOf),
      lpr: ser('lpr', asOf), csi: ser('csi', asOf)
    };
    var comp = zip(S.cpi, S.ppi, function (a, b) { return (a + b) / 2; });
    var inv = zip(S.ip, S.retail, function (a, b) { return a - b; });
    var spread = zip(S.m1, S.m2, function (a, b) { return a - b; });

    /* ===== 时钟 ===== */
    var sc = smooth(S.cpi), sp2 = smooth(S.ppi), si = smooth(S.ip), sk = smooth(comp);
    var gChg = chg(si, 6), gDir = dir(gChg), gFallback = false;
    var pmiV = lastV(S.pmi);
    if (gDir === 'flat') {
      gFallback = true;
      gDir = (pmiV !== null && pmiV >= 50) ? 'up' : 'down';
    }
    var iChg = chg(sk, 6), iDir = dir(iChg);
    if (iDir === 'flat') iDir = (iChg !== null && iChg > 0) ? 'up' : 'down';
    var nChg = chg(S.lpr, 6), nDir = dir(nChg, 0.01);
    var lprV = lastV(S.lpr);

    var realNow = (lprV !== null && comp.length) ? r2(lprV - lastV(comp)) : null;
    var realPrev = (S.lpr.length > 6 && comp.length > 6)
      ? r2(S.lpr[S.lpr.length - 7].v - comp[comp.length - 7].v) : null;
    var realChg = (realNow !== null && realPrev !== null) ? r2(realNow - realPrev) : null;
    var rDir = dir(realChg);

    var stage;
    if (gDir === 'down' && iDir === 'up') stage = (rDir !== 'up') ? 6 : 7;
    else if (gDir === 'up' && iDir === 'up') stage = (nDir === 'up') ? 5 : 4;
    else if (gDir === 'up' && iDir === 'down') stage = 3;
    else stage = (nDir === 'down') ? 2 : 1;

    var why = [], score = 100;
    if (gFallback) { score -= 20; why.push('增长处于平台期，方向借用 PMI 荣枯线（' + f1(pmiV) + '），属弱信号'); }
    var cpiChg = chg(sc, 6), ppiChg = chg(sp2, 6);
    if (cpiChg !== null && ppiChg !== null && ((cpiChg > 0.1) !== (ppiChg > 0.1)) && Math.abs(cpiChg - ppiChg) > 2) {
      score -= 20;
      why.push('CPI 与 PPI 方向背离（CPI 6 月 ' + (cpiChg > 0 ? '+' : '') + cpiChg + ' pct，PPI ' +
        (ppiChg > 0 ? '+' : '') + ppiChg + ' pct）');
    }
    var lc = lastChange(S.lpr, asOf);
    if (nDir === 'flat') why.push('LPR 自 ' + lc.d + ' 起未调整（' + lc.age + ' 个月），名义利率开关处于平台');
    if ((stage === 6 || stage === 7) && nDir !== 'up') {
      score -= 10;
      why.push('滞胀段通常伴随名义利率上行，当前政策尚未收紧，段位可能提前');
    }
    var level = score >= 75 ? '高' : (score >= 50 ? '中' : '低');

    /* ===== 基钦 ===== */
    var pChg = chg(smooth(S.ppi), 6), iChgK = chg(smooth(inv), 6);
    var ph = phaseOf(pChg, iChgK) || 'recession';
    var hist = phaseHist(S.ppi, inv, 36);
    var prevPh = ph;
    for (var i = hist.length - 2; i >= 0; i--) {
      if (hist[i].phase !== ph) { prevPh = hist[i].phase; break; }
    }

    /* ===== 朱格拉 ===== */
    var fChg = chg(S.fai, 12), fCur = lastV(S.fai), jPhase, jDir;
    if (fChg === null) { jPhase = '数据不足'; jDir = 'flat'; }
    else if (fChg > 0.2) {
      jPhase = (fCur !== null && fCur > 5) ? '资本开支扩张' : '产能出清尾声 · 企稳'; jDir = 'up';
    } else if (fChg < -0.2) {
      jPhase = (fCur !== null && fCur < 5) ? '产能过剩 · 出清中' : '扩张减速'; jDir = 'down';
    } else { jPhase = '产能平台期'; jDir = 'flat'; }

    /* ===== 库兹涅茨 ===== */
    var lChg = chg(S.loan, 12);
    var hUp = lastV(S.house), hPrev = S.house.length > 1 ? S.house[S.house.length - 2].v : null;
    var kPhase, kDir;
    if (hUp === null || hPrev === null) { kPhase = '数据不足'; kDir = 'flat'; }
    else {
      var hDir = hUp - hPrev > 0 ? 'up' : (hPrev - hUp > 0 ? 'down' : 'flat');
      if (hDir === 'up' && (lChg || 0) >= 0) { kPhase = '置业回暖 · 信用扩张'; kDir = 'up'; }
      else if (hDir === 'down' && (lChg || 0) < 0) { kPhase = '杠杆见顶 · 去杠杆'; kDir = 'down'; }
      else { kPhase = '分化：房价与信贷背离'; kDir = 'flat'; }
    }

    /* ===== 拐点次序 ===== */
    var allLast = [spread, S.ppi, S.csi, inv].filter(function (s) { return s.length; })
      .map(function (s) { return mi(s[s.length - 1].d); });
    var endMi = allLast.length ? Math.max.apply(null, allLast) : null;
    var asOfMi = mi(asOf.slice(0, 7));
    var nodes = [];
    if (endMi !== null) {
      var winStart = endMi - 30;
      [
        ['流动性底（M1-M2 剪刀差）', spread, function (v) { return v.toFixed(1); }],
        ['价格底（PPI 同比）', S.ppi, function (v) { return v.toFixed(1) + '%'; }],
        ['股价/大宗底（中证全指）', S.csi, function (v) { return v.toFixed(0); }],
        ['库存底（产销缺口代理）', inv, function (v) { return v.toFixed(1); }]
      ].forEach(function (row) {
        var s = row[1], fmt = row[2];
        var seg = s.filter(function (x) { return mi(x.d) >= winStart; });
        if (!seg.length) seg = s;
        if (!seg.length) return;
        var t = seg[0];
        seg.forEach(function (x) { if (x.v < t.v) t = x; });
        var cur = s[s.length - 1].v;
        var age = asOfMi - mi(t.d);
        var status;
        if (age <= 2 && Math.abs(cur - t.v) < 1e-9) status = 'pending';
        else if (age <= 3) status = 'fresh';
        else status = cur > t.v ? 'done' : 'pending';
        nodes.push({ name: row[0], t: t.d, mi: mi(t.d), v: fmt(t.v), now: fmt(cur), age: age, status: status });
      });
    }
    var orderOk = true, bad = null;
    for (var n = 0; n < nodes.length - 1; n++) {
      if (nodes[n].mi > nodes[n + 1].mi + 1) { orderOk = false; bad = [nodes[n], nodes[n + 1]]; break; }
    }
    nodes.forEach(function (x) { delete x.mi; });

    /* ===== 共振 ===== */
    function sg(d) { return d === 'up' ? 1 : (d === 'down' ? -1 : 0); }
    var big = sg(kDir) + sg(jDir);
    var smallUp = ph === 'recovery' || ph === 'depression';
    var res;
    if (big >= 0 && smallUp) res = { label: '同向共振', dir: 'up', text: '大周期不拖累 + 基钦上行，强复苏/大级别行情概率高' };
    else if (big < 0 && smallUp) res = { label: '异向压制', dir: 'down', text: '大周期仍在出清，基钦补库多为弱反弹，高度与持续性受限' };
    else if (big < 0) res = { label: '大小周期同向下', dir: 'down', text: '大周期出清叠加基钦去库，防守为主，等待流动性底与价格底' };
    else res = { label: '方向待定', dir: 'flat', text: '大周期与基钦方向不一，等待共振确认' };

    /* ===== 康波（年份锚点） ===== */
    var yr = yrFrac(asOf);
    var KB = [['繁荣', 1982, 2004], ['衰退', 2004, 2015], ['萧条', 2015, 2028], ['回升', 2028, 2035]];
    var kb = KB[0];
    KB.forEach(function (p) { if (yr >= p[1]) kb = p; });

    var cycles = [
      { key: 'kondra', name: '康波周期', span: '50-60 年', phase: kb[0], dir: 'flat',
        detail: '第五次康波 ' + kb[0] + '段（' + kb[1] + '–' + kb[2] + '），按年份锚点定位，距本段结束约 ' +
          Math.max(0, kb[2] - yr).toFixed(1) + ' 年' },
      { key: 'kuznets', name: '库兹涅茨周期', span: '15-20 年', phase: kPhase, dir: kDir,
        detail: '70 城新房环比上涨 ' + (hUp === null ? '—' : hUp + ' 城') +
          (hPrev === null ? '' : '（上月 ' + hPrev + ' 城）') + '；信贷同比 12 月变化 ' +
          (lChg === null ? '—' : (lChg > 0 ? '+' : '') + lChg + ' pct') },
      { key: 'juglar', name: '朱格拉周期', span: '9-10 年', phase: jPhase, dir: jDir,
        detail: '固投累计同比 ' + f1(fCur, '%') + '，12 个月变化 ' +
          (fChg === null ? '—' : (fChg > 0 ? '+' : '') + fChg + ' pct') },
      { key: 'kitchin', name: '基钦周期', span: '3-4 年', phase: PH[ph].name + ' · ' + PH[ph].sub,
        dir: (ph === 'recovery' || ph === 'depression') ? 'up' : 'down',
        detail: 'PPI 6 个月变化 ' + (pChg === null ? '—' : (pChg > 0 ? '+' : '') + pChg + ' pct') +
          '，产销缺口 6 个月变化 ' + (iChgK === null ? '—' : (iChgK > 0 ? '+' : '') + iChgK + ' pct') }
    ];

    var axes = {
      growth: { v: lastV(S.ip), m: lastD(S.ip), chg: gChg, dir: gDir,
        metric: gFallback ? '工增平台期 → 借用 PMI 荣枯线' : '工业增加值同比 6 个月变化（3 期平滑）',
        aux: 'PMI ' + f1(pmiV) },
      infl: { v: lastV(comp), m: lastD(comp), chg: iChg, dir: iDir,
        metric: '综合通胀 = CPI 与 PPI 同比均值',
        aux: 'CPI ' + f1(lastV(S.cpi)) + '% · PPI ' + f1(lastV(S.ppi)) + '%' },
      nominal: { v: lprV, m: lastD(S.lpr), chg: nChg, dir: nDir,
        metric: '1 年期 LPR（政策利率代理）',
        aux: lc.chg ? '最近调整 ' + lc.d + '（' + (lc.chg > 0 ? '+' : '') + lc.chg + ' pct）' : '最近为 ' + lc.d + '（持平）' },
      real: { v: realNow, m: lastD(comp), chg: realChg, dir: rDir,
        metric: '名义利率 − 综合通胀',
        aux: rDir === 'up' ? '通胀回落推高实际利率' : (rDir === 'down' ? '通胀上行压低实际利率' : '窄幅波动') }
    };

    /* ===== 小结 ===== */
    var sm = [];
    sm.push('数据口径：只取 ' + asOf + ' 之前已公布的数据 —— CPI/PPI ' + lastD(S.cpi) + '、工增 ' + lastD(S.ip) +
      '、社零 ' + lastD(S.retail) + '、固投 ' + lastD(S.fai) + '、PMI ' + lastD(S.pmi) + '、LPR ' + lastD(S.lpr) +
      '、70 城房价 ' + lastD(S.house) + '、中证全指 ' + lastD(S.csi) + '。');
    sm.push('时钟处在第 ' + stage + ' 段「' + STAGES[stage].name + '」：' + STAGES[stage].note + '。');
    sm.push('资产排序 —— 时钟：' + STAGES[stage].rank + '；基钦：' + ALLOC[ph].rank + '。');
    sm.push('周期共振「' + res.label + '」：' + res.text + '。');
    if (nodes.length === 4) {
      sm.push('拐点次序' + (orderOk ? '顺序成立' : '出现错位') + '：' +
        nodes.map(function (x) { return x.name.replace(/（.*?）/g, '') + ' ' + x.t; }).join(' → ') + '。');
    } else {
      sm.push('拐点次序：该时点可用序列不足（' + nodes.length + '/4），不做判断。');
    }
    sm.push('置信度 ' + level + '（' + Math.max(0, score) + ' 分）' +
      (why.length ? '：' + why.join('；') + '。' : '：各维度口径一致。'));

    return {
      asOf: asOf, stage: stage, stageMeta: STAGES[stage], angle: CLOCK_ANGLE[stage],
      axes: axes, conf: { level: level, score: Math.max(0, score), why: why },
      kitchin: { phase: ph, name: PH[ph].name, sub: PH[ph].sub, prev: prevPh, prevName: PH[prevPh].name,
        pChg: pChg, iChg: iChgK, alloc: ALLOC[ph], hist: hist },
      cycles: cycles, turning: nodes, orderOk: orderOk, bad: bad, resonance: res, summary: sm
    };
  }

  function lastChange(s, asOf) {
    for (var i = s.length - 1; i > 0; i--) {
      if (Math.abs(s[i].v - s[i - 1].v) > 1e-9) {
        return { d: s[i].d, chg: r2(s[i].v - s[i - 1].v), age: mi(asOf.slice(0, 7)) - mi(s[i].d) };
      }
    }
    return { d: s.length ? s[s.length - 1].d : '—', chg: 0, age: 0 };
  }

  /* ---------- 渲染 ---------- */
  function dirGlyph(d) { return d === 'up' ? '↑' : (d === 'down' ? '↓' : '→'); }
  function dirCls(d) { return d === 'up' ? 'u' : (d === 'down' ? 'd' : 'f'); }

  function pt(cx, cy, rad, deg) {
    var a = deg * Math.PI / 180;
    return [cx + Math.sin(a) * rad, cy - Math.cos(a) * rad];
  }
  function arcPath(cx, cy, R, r, a0, a1) {
    var o0 = pt(cx, cy, R, a0), o1 = pt(cx, cy, R, a1), i0 = pt(cx, cy, r, a0), i1 = pt(cx, cy, r, a1);
    return 'M' + o0[0].toFixed(2) + ' ' + o0[1].toFixed(2) +
      ' A' + R + ' ' + R + ' 0 0 1 ' + o1[0].toFixed(2) + ' ' + o1[1].toFixed(2) +
      ' L' + i1[0].toFixed(2) + ' ' + i1[1].toFixed(2) +
      ' A' + r + ' ' + r + ' 0 0 0 ' + i0[0].toFixed(2) + ' ' + i0[1].toFixed(2) + ' Z';
  }

  function dial(stage) {
    var cx = 76, cy = 76, R = 68, r = 43, half = 180 / 7, out = '';
    for (var k = 1; k <= 7; k++) {
      var cur = k === stage;
      out += '<path d="' + arcPath(cx, cy, R, r, CLOCK_ANGLE[k] - half, CLOCK_ANGLE[k] + half) +
        '" fill="' + (cur ? '#1c2433' : '#f3efe6') + '" stroke="#fff" stroke-width="1.5"/>';
      var m = pt(cx, cy, (R + r) / 2, CLOCK_ANGLE[k]);
      out += '<text x="' + m[0].toFixed(1) + '" y="' + (m[1] + 3.4).toFixed(1) +
        '" text-anchor="middle" font-size="9.5" font-family="JBMono,monospace" fill="' +
        (cur ? '#fff' : '#a89c84') + '">' + k + '</text>';
    }
    var p = pt(cx, cy, R + 1, CLOCK_ANGLE[stage]);
    out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.4" fill="#a8854a"/>';
    return '<svg viewBox="0 0 152 152" class="cyc-dial" role="img" aria-label="七段时钟">' + out + '</svg>';
  }

  function axisRow(k, ax) {
    return '<div class="cyc-axis">' +
      '<span class="k" title="' + U.esc(ax.metric) + '">' + k + '</span>' +
      '<b class="' + dirCls(ax.dir) + '">' + dirGlyph(ax.dir) + ' ' +
        (ax.v === null ? '—' : Number(ax.v).toFixed(1) + '%') + '</b>' +
      '<span class="a">' + U.esc(ax.aux) + ' · ' + ax.m + '</span>' +
      '</div>';
  }

  function render() {
    var body = $('cycBody');
    if (!body) return;
    var r = last && last.res;
    if (!r) {
      body.innerHTML = '<div class="cyc-empty">勾选后点「按当前时点推导」，只用该日期之前已公布的宏观数据计算，' +
        '得到的是当时能看到的结论（非后视镜）。调整时间不会自动刷新，需要重新点一次。</div>';
      return;
    }
    var sm = r.summary.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('');
    var axes = axisRow('增长', r.axes.growth) + axisRow('通胀', r.axes.infl) +
      axisRow('名义利率', r.axes.nominal) + axisRow('实际利率', r.axes.real);
    var st = r.stageMeta;

    var conf = '<div class="cyc-conf"><span>置信度</span><b class="lv-' +
      ({ '高': 'high', '中': 'mid', '低': 'low' }[r.conf.level]) + '">' + r.conf.level +
      ' · ' + r.conf.score + '</b>' + (r.conf.why.length ? '<ul>' + r.conf.why.map(function (x) {
        return '<li>' + U.esc(x) + '</li>';
      }).join('') + '</ul>' : '<span class="ok">各维度口径一致</span>') + '</div>';

    var left = '<div class="cyc-card">' +
      '<div class="cyc-card-h"><b>荀玉根 · 改良美林时钟</b><em>七段 · 增长 × 通胀 × 利率</em></div>' +
      '<div class="cyc-clock">' + dial(r.stage) +
        '<div class="cyc-stage">' +
          '<span class="no">第 ' + r.stage + ' 段</span>' +
          '<strong>' + st.name + '</strong>' +
          '<span class="tag">' + st.tag + '</span>' +
          '<p>' + U.esc(st.note) + '</p>' +
          '<div class="rank">' + U.esc(st.rank) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cyc-axes">' + axes + '</div>' + conf + '</div>';

    var dirTxt = { up: '上行', down: '下行', flat: '走平' };
    var cards = r.cycles.map(function (c) {
      return '<div class="cyc-cyc">' +
        '<div class="h"><b>' + c.name + '</b><span>' + c.span + '</span></div>' +
        '<div class="p"><strong>' + U.esc(c.phase) + '</strong>' +
        '<em class="' + c.dir + '">' + dirTxt[c.dir] + '</em></div>' +
        '<p>' + U.esc(c.detail) + '</p></div>';
    }).join('');

    var strip = r.kitchin.hist.length ? r.kitchin.hist.slice(-14).map(function (x) {
      return '<i class="' + x.phase + '" title="' + x.d + ' · ' + PH[x.phase].name + '"></i>';
    }).join('') : '<span class="na">阶段序列不足</span>';

    var kit = '<div class="cyc-kit">' +
      '<div class="cyc-card-h"><b>基钦四阶段</b><em>' + r.kitchin.name + ' · ' + r.kitchin.sub +
        '（上一段 ' + r.kitchin.prevName + '）</em></div>' +
      '<div class="cyc-strip">' + [0, 1, 2, 3].map(function (o) {
        var key = ['recession', 'depression', 'recovery', 'overheat'][o];
        var on = key === r.kitchin.phase;
        return '<div class="seg' + (on ? ' on' : '') + '"><b>' + KITCHIN[o][0] + '</b><span>' + KITCHIN[o][1] + '</span></div>';
      }).join('') + '</div>' +
      '<div class="cyc-hist">近 14 个月阶段：' + strip + '</div>' +
      '<div class="cyc-alloc"><span>' + r.kitchin.alloc.tag + '</span><b>' + U.esc(r.kitchin.alloc.rank) + '</b></div>' +
      '</div>';

    var statusTxt = { done: '已确认', fresh: '刚出现', pending: '待确认' };
    var turn = '<div class="cyc-turn"><div class="cyc-card-h"><b>拐点次序</b><em>流动性底 → 价格底 → 股价底 → 库存底</em></div>' +
      (r.turning.length ? r.turning.map(function (x) {
        return '<div class="row"><span>' + U.esc(x.name) + '</span><b class="mono">' + x.t + '</b>' +
          '<span class="now">' + x.v + ' → ' + x.now + '</span>' +
          '<em class="s-' + x.status + '">' + statusTxt[x.status] + '</em></div>';
      }).join('') : '<div class="na">该时点序列不足</div>') +
      '<div class="cyc-order' + (r.orderOk ? '' : ' bad') + '">' +
        (r.orderOk ? '次序成立：前一节点确认后，后一节点胜率更高' :
          '次序错位：' + (r.bad ? U.esc(r.bad[0].name) + '（' + r.bad[0].t + '）晚于 ' +
            U.esc(r.bad[1].name) + '（' + r.bad[1].t + '）' : '存在逆序')) + '</div>' +
      '</div>';

    var right = '<div class="cyc-card">' +
      '<div class="cyc-card-h"><b>周金涛 · 周期罗盘</b><em>康波 / 库兹涅茨 / 朱格拉 / 基钦</em></div>' +
      '<div class="cyc-cycles">' + cards + '</div>' + kit +
      '<div class="cyc-res ' + r.resonance.dir + '"><b>' + r.resonance.label + '</b><span>' +
        U.esc(r.resonance.text) + '</span></div>' + turn + '</div>';

    body.innerHTML = '<div class="cyc-grid">' + left + right + '</div>' +
      '<div class="cyc-sum"><div class="cyc-card-h"><b>时点小结</b><em>' + r.asOf +
        ' · 非后视镜</em></div><ul>' + sm + '</ul></div>';
  }

  function stamp() {
    var el = $('cycStamp');
    if (!el) return;
    var S = SB.engine.session();
    if (!last) { el.textContent = S ? '未推导 · 当前 ' + S.date : '--'; el.className = 'cyc-stamp'; return; }
    if (S && S.date !== last.asOf) {
      el.textContent = '结论基于 ' + last.asOf + ' · 当前已到 ' + S.date;
      el.className = 'cyc-stamp stale';
    } else {
      el.textContent = '结论时点 ' + last.asOf;
      el.className = 'cyc-stamp';
    }
  }

  function derive() {
    var S = SB.engine.session();
    if (!S) return U.toast('还没有进行中的复盘');
    var btn = $('cycRun');
    if (btn) { btn.disabled = true; btn.textContent = '推导中…'; }
    load().then(function () {
      last = { asOf: S.date, res: compute(S.date) };
      render();
      stamp();
      U.toast('已按 ' + S.date + ' 前公布的数据推导');
    }).catch(function (e) {
      U.toast('宏观数据加载失败：' + e.message);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '按当前时点推导'; }
    });
  }

  function toggle(on) {
    var panel = $('cycPanel');
    if (!panel) return;
    panel.hidden = !on;
    if (on) { render(); stamp(); load().catch(function () {}); }
  }

  function sync() { stamp(); }

  return { toggle: toggle, derive: derive, sync: sync, compute: compute, load: load };
})();
