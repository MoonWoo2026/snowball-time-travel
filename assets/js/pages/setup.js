/* 新建复盘：时点、本金、自选股、运行模式 + 策略预设 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var watch = [];
  var existing = null;

  SB.guide.auto();

  /* 运行模式 */
  var MODE = 'manual';              // manual | both | auto
  var PRESETS = [];                 // [{plan, enabled, color}]
  var CURVE_COLORS = ['#6B8FB8', '#8B6E5A', '#4A8F6A', '#A57989'];

  /* 三套经典模板 */
  var TEMPLATES = [
    { label: '每月定投 ¥2 万 + 季度再平衡', make: function (ctx) { return { type:'dca', name:'每月定投 ¥2 万', dcaPeriod:'month', dcaAmount:20000, rebalPeriod:'quarter', capital: ctx.capital, codes: ctx.codes.slice() }; } },
    { label: '季度定投 ¥5 万 + PB ≤1.0 买/≥2.0 卖', make: function (ctx) { return { type:'dca', name:'季度定投 ¥5 万', dcaPeriod:'quarter', dcaAmount:50000, tpPct:null, slPct:null, holdDays:null, capital: ctx.capital, codes: ctx.codes.slice() }; } },
    { label: 'PB ≤0.9 低估买入 / PB ≥1.8 高估卖出', make: function (ctx) { return { type:'value', name:'PB ≤0.9 低估买入', valConds:[{m:'pb',v:0.9}], valLogic:'any', valAmount:50000, valSellConds:[{m:'pb',v:1.8}], valSellLogic:'any', capital: ctx.capital, codes: ctx.codes.slice() }; } }
  ];

  function $(id) { return document.getElementById(id); }

  SB.market.load().then(function () {
    E.init();
    existing = E.load();
    U.header('setup');
    var meta = M.meta();
    var first = meta.calendar[0], last = meta.endDate;

    var input = $('startDate');
    input.min = first;
    input.max = last;
    input.value = existing ? existing.startDate : '2016-11-09';
    if (input.value < first) input.value = first;
    if (input.value > last) input.value = last;

    $('capital').value = existing ? Math.round(existing.initCash / 10000) : 200;
    updateCap();
    watch = existing ? existing.watch.slice() : meta.stocks.filter(function (s) { return s.default; }).map(function (s) { return s.code; });
    $('overwriteTip').textContent = existing ? '开始后将覆盖当前进度（' + existing.date + '），如需保留请先到首页存档' : '开始后时间只会向前走';
    renderChips();

    // 恢复已存的预设（切换模式或重进 setup 页不丢失）
    var sess = E.session();
    var saved = sess && sess._presetStrats;
    var savedMode = 'manual';
    if (saved && saved.length) {
      PRESETS = saved.slice(0, 4).map(function (p, i) {
        return { plan: p.plan, enabled: true, color: p.color || CURVE_COLORS[i % CURVE_COLORS.length] };
      });
      savedMode = sess._mode || 'both';
    }
    setMode(savedMode);

    bind();
  }).catch(function (e) {
    U.loadFail(e);
  });

  function updateCap() {
    var wan = Math.max(1, Number($('capital').value) || 1);
    $('capCny').textContent = U.money(wan * 10000);
  }

  function renderChips() {
    var box = $('pickChips');
    if (!watch.length) {
      box.innerHTML = '<span class="small">还没有选择标的，至少保留一只。</span>';
      return;
    }
    box.innerHTML = watch.map(function (code) {
      var st = M.stock(code);
      if (!st) return '';
      return '<span class="pick-chip" data-code="' + code + '"><b>' + U.esc(st.name) + '</b>' +
        '<span>' + code + ' · ' + st.market + '</span>' +
        '<button type="button" data-rm="' + code + '" aria-label="移除">×</button></span>';
    }).join('');
  }

  function pool(kw) {
    var has = {};
    watch.forEach(function (c) { has[c] = 1; });
    return M.meta().stocks.filter(function (s) {
      if (has[s.code]) return false;
      if (!kw) return true;
      return s.code.indexOf(kw) >= 0 || s.name.indexOf(kw) >= 0 ||
        (s.sector || '').indexOf(kw) >= 0;
    });
  }

  function renderResults(kw) {
    var box = $('pickResults');
    var list = pool(kw).slice(0, 12);
    if (!list.length) {
      box.innerHTML = '<div class="pick-row">没有匹配的标的</div>';
      box.classList.remove('hide');
      return;
    }
    box.innerHTML = list.map(function (s) {
      return '<div class="pick-row" data-add="' + s.code + '"><b>' + U.esc(s.name) + '</b>' +
        '<span>' + s.code + ' · ' + s.market + ' · ' + U.esc(s.sector || '') + '</span>' +
        '<em>加入</em></div>';
    }).join('');
    box.classList.remove('hide');
  }

  /* ---- 运行模式 ---- */
  function setMode(m) {
    MODE = m;
    document.querySelectorAll('.mode-item').forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-mode') === m);
      el.querySelector('input').checked = (el.getAttribute('data-mode') === m);
    });
    $('presetBox').style.display = (m === 'both' || m === 'auto') ? '' : 'none';
    renderPresetList();
    var btn = $('go');
    btn.textContent = m === 'auto' ? '直接跑自动策略 →' : '进入交易终端';
  }

  function renderPresetList() {
    var list = $('presetList');
    if (!PRESETS.length) {
      list.innerHTML =
        '<div class="preset-row disabled" style="border-style:dashed">' +
          '<div class="pr-main">' +
            '<b>还没有预设策略</b>' +
            '<span>点右上角「+ 添加策略」或选一个经典模板</span>' +
          '</div>' +
          '<select id="tmplSelect" style="border:1px solid var(--rule);border-radius:4px;padding:4px 6px;font-size:11px">' +
            '<option value="">快速添加模板…</option>' +
            TEMPLATES.map(function (t, i) { return '<option value="' + i + '">' + t.label + '</option>'; }).join('') +
          '</select>' +
        '</div>';
      var sel = $('tmplSelect');
      if (sel) sel.onchange = function () {
        if (this.value !== '') {
          addTemplate(+this.value);
          this.value = '';
        }
      };
      return;
    }
    list.innerHTML = PRESETS.map(function (p, i) {
      return '<div class="preset-row' + (p.enabled ? '' : ' disabled') + '">' +
        '<input type="checkbox" class="pr-toggle" data-i="' + i + '"' + (p.enabled ? ' checked' : '') + '>' +
        '<div class="pr-color" style="background:' + p.color + '"></div>' +
        '<div class="pr-main">' +
          '<b>' + U.esc(p.plan.name) + '</b>' +
          '<span>' + describePlan(p.plan) + '</span>' +
        '</div>' +
        '<button class="pr-del" type="button" data-e="' + i + '" title="编辑">✎</button>' +
        '<button class="pr-del" type="button" data-x="' + i + '" title="删除">×</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.pr-toggle').forEach(function (cb) {
      cb.onchange = function () { PRESETS[+cb.getAttribute('data-i')].enabled = cb.checked; renderPresetList(); };
    });
    list.querySelectorAll('[data-x]').forEach(function (b) {
      b.onclick = function () { PRESETS.splice(+b.getAttribute('data-x'), 1); renderPresetList(); };
    });
    list.querySelectorAll('[data-e]').forEach(function (b) {
      b.onclick = function () { openPresetDialog(+b.getAttribute('data-e')); };
    });
  }

  function describePlan(p) {
    var codes = (p.codes || []).length;
    if (p.type === 'dca') {
      var t = p.dcaPeriod === 'week' ? '每周' : p.dcaPeriod === 'month' ? '每月' : '每季度';
      var s = t + '定投 ¥' + (p.dcaAmount || 0).toLocaleString() + '，等权投 ' + codes + ' 只';
      if (p.dcaTotal > 0) s += '，总额 ¥' + p.dcaTotal.toLocaleString() + ' 投完即止';
      if (p.rebalPeriod) s += '，' + (p.rebalPeriod === 'month' ? '每月' : p.rebalPeriod === 'quarter' ? '每季度' : '每年') + '再平衡';
      return s;
    }
    var s = condText(p.valConds, p.valLogic, false) + (p.valAll ? ' 全仓买入' : ' 买入 ¥' + (p.valAmount || 0).toLocaleString());
    if (p.valSellConds && p.valSellConds.length) s += ' / ' + condText(p.valSellConds, p.valSellLogic, true) + ' 卖出';
    return s;
  }

  /* 条件文案：PB/PE 越低越便宜，股息率越高越便宜 */
  function condText(conds, logic, isSell) {
    if (!conds || !conds.length) return '—';
    var label = { pb: 'PB', pe: 'PE', dy: '股息率' };
    return conds.map(function (c) {
      var op = c.m === 'dy' ? (isSell ? ' ≤ ' : ' ≥ ') : (isSell ? ' ≥ ' : ' ≤ ');
      return (label[c.m] || c.m) + op + c.v + (c.m === 'dy' ? '%' : '');
    }).join(logic === 'all' ? ' 且 ' : ' 或 ');
  }

  function addTemplate(i) {
    if (PRESETS.length >= 4) return U.toast('最多 4 条');
    var plan = TEMPLATES[i].make({ capital: getCapital(), codes: watch.length ? watch : ['600036','600519'] });
    var color = CURVE_COLORS[PRESETS.length];
    PRESETS.push({ plan: plan, enabled: true, color: color });
    renderPresetList();
  }

  function getCapital() {
    return Math.max(1, Number($('capital').value) || 1) * 10000;
  }

  function newPlan() {
    return {
      type: 'dca', start: $('startDate').value, capital: getCapital(), codes: watch.slice(),
      dcaPeriod: 'month', dcaAmount: 20000, dcaTotal: 0, rebalPeriod: null,
      valConds: [{ m: 'pb', v: 1.0 }], valLogic: 'any', valAmount: 50000, valGapDays: 30,
      valSellConds: [], valSellLogic: 'any',
      tpPct: null, tpMode: 'full', slPct: null, holdDays: null,
      name: ''
    };
  }

  function openPresetDialog(idx) {
    if (watch.length < 1) return U.toast('请先选至少一只自选股');
    if (!M.meta().stocks.length) return U.toast('数据尚未加载，请稍等');
    var editing = idx != null;
    if (!editing && PRESETS.length >= 4) return U.toast('最多 4 条策略');
    var plan = editing ? JSON.parse(JSON.stringify(PRESETS[idx].plan)) : newPlan();
    var picked = (plan.codes || []).filter(function (c) { return watch.indexOf(c) >= 0; });
    if (!picked.length) picked = watch.slice();

    function stepperHTML(id, val, step, min) {
      return '<span class="stepper">' +
        '<button type="button" data-st="-1" data-step="' + step + '" data-for="' + id + '">−</button>' +
        '<input id="' + id + '" type="number" value="' + val + '" step="' + step + '"' + (min != null ? ' min="' + min + '"' : '') + '>' +
        '<button type="button" data-st="1" data-step="' + step + '" data-for="' + id + '">+</button>' +
      '</span>';
    }

    // 估值条件：兼容旧的单指标 valMetric / valBuy / valSell
    var bc = plan.valConds || (plan.valMetric ? [{ m: plan.valMetric, v: plan.valBuy }] : [{ m: 'pb', v: 1.0 }]);
    var sc = plan.valSellConds || (plan.valSell ? [{ m: plan.valMetric || 'pb', v: plan.valSell }] : []);
    function condVal(arr, m, dflt) {
      var f = arr.filter(function (x) { return x.m === m; })[0];
      return f && f.v != null ? f.v : dflt;
    }
    function condOn(arr, m) { return arr.some(function (x) { return x.m === m; }); }
    var buyD = { pb: condVal(bc, 'pb', 1.0), pe: condVal(bc, 'pe', 15), dy: condVal(bc, 'dy', 4) };
    var buyOn = { pb: condOn(bc, 'pb'), pe: condOn(bc, 'pe'), dy: condOn(bc, 'dy') };
    var sellD = { pb: condVal(sc, 'pb', 2.0), pe: condVal(sc, 'pe', 30), dy: condVal(sc, 'dy', 2) };
    var sellOn = { pb: condOn(sc, 'pb'), pe: condOn(sc, 'pe'), dy: condOn(sc, 'dy') };

    function condRowHTML(pfx, m, label, op, val, on, step) {
      var id = pfx + '_' + m;
      return '<div class="cond-row">' +
        '<input type="checkbox" id="' + id + '_on"' + (on ? ' checked' : '') + '>' +
        '<span class="cr-name">' + label + '</span>' +
        '<span class="cr-op">' + op + '</span>' +
        '<span class="stepper">' +
          '<button type="button" data-st="-1" data-step="' + step + '" data-for="' + id + '">−</button>' +
          '<input id="' + id + '" type="number" step="' + step + '" value="' + val + '" min="0">' +
          '<button type="button" data-st="1" data-step="' + step + '" data-for="' + id + '">+</button>' +
        '</span>' +
      '</div>';
    }

    var mask = document.createElement('div');
    mask.className = 'mask on';
    mask.innerHTML =
      '<div class="modal strat-modal">' +
        '<h4>' + (editing ? '编辑策略' : '添加自动策略') + '</h4>' +
        '<div class="fld"><span class="fld-t">策略类型</span>' +
          '<div class="seg" id="ptType">' +
            '<button data-t="dca" class="' + (plan.type==='dca'?'on':'') + '">等权定投</button>' +
            '<button data-t="value" class="' + (plan.type==='value'?'on':'') + '">估值触发</button>' +
          '</div>' +
        '</div>' +
        '<div class="fld"><span class="fld-t">定投标的</span>' +
          '<span class="code-head"><span id="ptCnt">已选 ' + picked.length + ' / ' + watch.length + '</span>' +
            '<button type="button" id="ptAll">全选</button>' +
            '<button type="button" id="ptNone">清空</button></span>' +
          '<span class="pick-codes" id="ptCodes">' +
            watch.map(function (c) {
              var st = M.stock(c);
              return '<span class="code-chip' + (picked.indexOf(c) >= 0 ? ' on' : '') + '" data-c="' + c + '">' +
                U.esc(st ? st.name : c) + '<i>' + c + '</i></span>';
            }).join('') +
          '</span>' +
          '<span class="k tiny">策略资金在这些标的之间等权分配</span>' +
        '</div>' +
        '<div class="s-row"><label>曲线名 <input id="ptName" value="' + U.esc(plan.name || '') + '" placeholder="比如 每月定投 ¥2 万"></label></div>' +
        '<div class="pt-dca" style="' + (plan.type==='dca'?'':'display:none') + '">' +
          '<div class="s-row">' +
            '<div class="fld thin"><span class="fld-t">定投周期</span>' +
              '<div class="seg" id="ptPeriod">' +
                '<button data-p="week" class="' + (plan.dcaPeriod==='week'?'on':'') + '">每周</button>' +
                '<button data-p="month" class="' + (plan.dcaPeriod==='month'?'on':'') + '">每月</button>' +
                '<button data-p="quarter" class="' + (plan.dcaPeriod==='quarter'?'on':'') + '">每季度</button>' +
              '</div>' +
            '</div>' +
            '<label class="thin">定期再平衡' +
              '<select id="ptRebal">' +
                '<option value="">关闭</option>' +
                '<option value="month"' + (plan.rebalPeriod==='month'?' selected':'') + '>每月</option>' +
                '<option value="quarter"' + (plan.rebalPeriod==='quarter'?' selected':'') + '>每季度</option>' +
                '<option value="year"' + (plan.rebalPeriod==='year'?' selected':'') + '>每年</option>' +
              '</select>' +
            '</label>' +
          '</div>' +
          '<div class="fld thin"><span class="fld-t">每期总金额（CNY）</span>' +
            stepperHTML('ptAmount', plan.dcaAmount||20000, 1000, 0) +
            '<span class="quick-amt" id="ptAmtQuick">' +
              [2000,10000,20000,50000,100000].map(function (v) {
                return '<button type="button" data-v="' + v + '">' + (v>=10000 ? (v/10000)+' 万' : (v/1000)+' 千') + '</button>';
              }).join('') +
            '</span>' +
          '</div>' +
          '<div class="fld thin"><span class="fld-t">定投总额（CNY）<i class="k tiny">投完即止，不再有新增买入</i></span>' +
            stepperHTML('ptDcaTotal', plan.dcaTotal || plan.capital || 0, 50000, 0) +
            '<span class="quick-amt" id="ptTotalQuick">' +
              [100000,200000,500000,1000000].map(function (v) {
                return '<button type="button" data-v="' + v + '">' + (v/10000) + ' 万</button>';
              }).join('') +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pt-value" style="' + (plan.type==='value'?'':'display:none') + '">' +
          '<div class="fld"><span class="fld-t">买入条件 <i class="k tiny">勾选需要的指标，触发即买入</i></span>' +
            '<div class="cond-list">' +
              condRowHTML('ptB', 'pb', 'PB 市净率', '≤', buyD.pb, buyOn.pb, 0.1) +
              condRowHTML('ptB', 'pe', 'PE(TTM)', '≤', buyD.pe, buyOn.pe, 1) +
              condRowHTML('ptB', 'dy', '股息率', '≥', buyD.dy, buyOn.dy, 0.5) +
            '</div>' +
            '<div class="logic-line"><span>触发方式</span>' +
              '<div class="seg" id="ptBuyLogic">' +
                '<button data-l="any" class="' + (plan.valLogic==='all'?'':'on') + '">任一满足</button>' +
                '<button data-l="all" class="' + (plan.valLogic==='all'?'on':'') + '">全部满足</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="s-row">' +
            '<div class="fld thin"><span class="fld-t">每次买入金额（CNY）</span>' + stepperHTML('ptValAmount', plan.valAmount||50000, 1000, 0) + '</div>' +
            '<div class="fld thin"><span class="fld-t">买入间隔（天）</span>' + stepperHTML('ptValGap', plan.valGapDays==null?30:plan.valGapDays, 5, 1) + '</div>' +
          '</div>' +
          '<label class="chk-inline"><input type="checkbox" id="ptValAll"' + (plan.valAll?' checked':'') + '> 全仓买入：触发时用账户全部可用资金（当天多只触发则等分）</label>' +
          '<div class="fld"><span class="fld-t">卖出条件 <i class="k tiny">留空=不卖，长期持有</i></span>' +
            '<div class="cond-list">' +
              condRowHTML('ptS', 'pb', 'PB 市净率', '≥', sellD.pb, sellOn.pb, 0.1) +
              condRowHTML('ptS', 'pe', 'PE(TTM)', '≥', sellD.pe, sellOn.pe, 1) +
              condRowHTML('ptS', 'dy', '股息率', '≤', sellD.dy, sellOn.dy, 0.5) +
            '</div>' +
            '<div class="logic-line"><span>触发方式</span>' +
              '<div class="seg" id="ptSellLogic">' +
                '<button data-l="any" class="' + (plan.valSellLogic==='all'?'':'on') + '">任一满足</button>' +
                '<button data-l="all" class="' + (plan.valSellLogic==='all'?'on':'') + '">全部满足</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sell-block">' +
          '<div class="sell-head">卖出规则（留空=不触发）</div>' +
          '<div class="s-row">' +
            '<label>目标收益率止盈 ' + stepperHTML('ptTpPct', plan.tpPct ? Math.round(plan.tpPct*100) : '', 5, 0) + '</label>' +
            '<label>止盈方式 <select id="ptTpMode">' +
              '<option value="full"' + (plan.tpMode!=='part'?' selected':'') + '>一次性全清</option>' +
              '<option value="part"' + (plan.tpMode==='part'?' selected':'') + '>分批（1/3 起步）</option>' +
            '</select></label>' +
            '<label class="thin">止损（浮亏 ≥）' + stepperHTML('ptSlPct', plan.slPct ? Math.round(plan.slPct*100) : '', 5, 0) + '</label>' +
            '<label class="thin">持有期到期（天）' + stepperHTML('ptHoldDays', plan.holdDays||'', 30, 0) + '</label>' +
          '</div>' +
        '</div>' +
        '<div class="m-act">' +
          '<button class="btn ghost" id="ptCancel">取消</button>' +
          '<button class="btn" id="ptSave">' + (editing ? '保存' : '添加') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    function updateVis() {
      var t = mask.querySelector('#ptType button.on').getAttribute('data-t');
      mask.querySelector('.pt-dca').style.display = t === 'dca' ? '' : 'none';
      mask.querySelector('.pt-value').style.display = t === 'value' ? '' : 'none';
    }
    mask.querySelectorAll('#ptType button').forEach(function (b) {
      b.onclick = function () {
        mask.querySelectorAll('#ptType button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        updateVis();
      };
    });
    updateVis();

    // 标的勾选
    function refreshCnt() {
      var n = mask.querySelectorAll('#ptCodes .code-chip.on').length;
      mask.querySelector('#ptCnt').textContent = '已选 ' + n + ' / ' + watch.length;
    }
    mask.querySelectorAll('#ptCodes .code-chip').forEach(function (chip) {
      chip.onclick = function () { chip.classList.toggle('on'); refreshCnt(); };
    });
    mask.querySelector('#ptAll').onclick = function () {
      mask.querySelectorAll('#ptCodes .code-chip').forEach(function (c) { c.classList.add('on'); });
      refreshCnt();
    };
    mask.querySelector('#ptNone').onclick = function () {
      mask.querySelectorAll('#ptCodes .code-chip').forEach(function (c) { c.classList.remove('on'); });
      refreshCnt();
    };

    // 周期 / 触发方式分段
    function wireSeg(sel) {
      mask.querySelectorAll(sel + ' button').forEach(function (b) {
        b.onclick = function () {
          mask.querySelectorAll(sel + ' button').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        };
      });
    }
    wireSeg('#ptPeriod');
    wireSeg('#ptBuyLogic');
    wireSeg('#ptSellLogic');

    // 数字步进
    mask.querySelectorAll('.stepper button').forEach(function (b) {
      b.onclick = function () {
        var inp = mask.querySelector('#' + b.getAttribute('data-for'));
        var step = +b.getAttribute('data-step');
        var v = (+inp.value || 0) + (+b.getAttribute('data-st')) * step;
        inp.value = Math.max(0, Math.round(v * 100) / 100);
      };
    });
    // 快捷金额
    function wireQuick(boxId, inputId) {
      mask.querySelectorAll('#' + boxId + ' button').forEach(function (b) {
        b.onclick = function () {
          mask.querySelector('#' + inputId).value = b.getAttribute('data-v');
          mask.querySelectorAll('#' + boxId + ' button').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        };
      });
    }
    wireQuick('ptAmtQuick', 'ptAmount');
    wireQuick('ptTotalQuick', 'ptDcaTotal');
    // 全仓买入：勾上后金额输入失效
    var allBox = mask.querySelector('#ptValAll');
    function syncValAll() {
      var on = allBox.checked;
      mask.querySelectorAll('#ptValAmount, .stepper button[data-for="ptValAmount"]').forEach(function (el) { el.disabled = on; });
      mask.querySelector('#ptValAmount').closest('.fld').style.opacity = on ? .45 : 1;
    }
    allBox.addEventListener('change', syncValAll);
    syncValAll();

    mask.querySelector('#ptCancel').onclick = function () { mask.remove(); };
    mask.querySelector('.modal').onclick = function (e) { e.stopPropagation(); };
    mask.onclick = function () { mask.remove(); };

    mask.querySelector('#ptSave').onclick = function () {
      var t = mask.querySelector('#ptType button.on').getAttribute('data-t');
      var codes = [];
      mask.querySelectorAll('#ptCodes .code-chip.on').forEach(function (c) { codes.push(c.getAttribute('data-c')); });
      if (!codes.length) return U.toast('至少勾选一个定投标的');

      plan.type = t;
      plan.name = mask.querySelector('#ptName').value.trim() || (t === 'dca' ? '等权定投' : '估值触发');
      plan.start = $('startDate').value;
      plan.capital = getCapital();
      plan.codes = codes;
      if (t === 'dca') {
        plan.dcaPeriod = mask.querySelector('#ptPeriod button.on').getAttribute('data-p');
        plan.dcaAmount = +mask.querySelector('#ptAmount').value || 10000;
        plan.dcaTotal = +mask.querySelector('#ptDcaTotal').value || 0;
        plan.rebalPeriod = mask.querySelector('#ptRebal').value || null;
      } else {
        function readConds(pfx) {
          var out = [];
          ['pb', 'pe', 'dy'].forEach(function (m) {
            var cb = mask.querySelector('#' + pfx + '_' + m + '_on');
            if (!cb || !cb.checked) return;
            var v = mask.querySelector('#' + pfx + '_' + m).value;
            if (v !== '') out.push({ m: m, v: +v });
          });
          return out;
        }
        var buyConds = readConds('ptB');
        if (!buyConds.length) return U.toast('至少勾选一个买入条件');
        plan.valConds = buyConds;
        plan.valLogic = mask.querySelector('#ptBuyLogic button.on').getAttribute('data-l');
        plan.valAmount = +mask.querySelector('#ptValAmount').value || 20000;
        plan.valAll = mask.querySelector('#ptValAll').checked;
        plan.valGapDays = +mask.querySelector('#ptValGap').value || 30;
        plan.valSellConds = readConds('ptS');
        plan.valSellLogic = mask.querySelector('#ptSellLogic button.on').getAttribute('data-l');
        // 清掉旧版单指标字段，避免引擎走兼容分支
        delete plan.valMetric; delete plan.valBuy; delete plan.valSell;
      }
      var tp = mask.querySelector('#ptTpPct').value;
      var sl = mask.querySelector('#ptSlPct').value;
      var hd = mask.querySelector('#ptHoldDays').value;
      plan.tpPct = tp ? +tp / 100 : null;
      plan.tpMode = mask.querySelector('#ptTpMode').value;
      plan.slPct = sl ? +sl / 100 : null;
      plan.holdDays = hd ? +hd : null;

      if (editing) {
        PRESETS[idx].plan = plan;
      } else {
        if (PRESETS.length >= 4) { U.toast('最多 4 条'); mask.remove(); return; }
        // 没填名字就按参数自动生成，方便多条策略区分
        if (!mask.querySelector('#ptName').value.trim()) {
          plan.name = t === 'dca'
            ? (plan.dcaPeriod === 'week' ? '每周定投 ¥' : plan.dcaPeriod === 'month' ? '每月定投 ¥' : '每季度定投 ¥') + plan.dcaAmount.toLocaleString()
            : condText(plan.valConds, plan.valLogic, false) + ' 估值买入';
        }
        PRESETS.push({ plan: plan, enabled: true, color: CURVE_COLORS[PRESETS.length % CURVE_COLORS.length] });
      }
      renderPresetList();
      mask.remove();
    };
  }

  /* ---- 事件绑定 ---- */
  function bind() {
    $('capital').addEventListener('input', updateCap);

    $('pickChips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rm]');
      if (!btn) return;
      watch = watch.filter(function (c) { return c !== btn.getAttribute('data-rm'); });
      renderChips();
    });

    $('pickSearch').addEventListener('input', function () { renderResults(this.value.trim()); });
    $('pickSearch').addEventListener('focus', function () { renderResults(this.value.trim()); });
    $('pickResults').addEventListener('mousedown', function (e) {
      var row = e.target.closest('[data-add]');
      if (!row) return;
      e.preventDefault();
      var code = row.getAttribute('data-add');
      if (watch.indexOf(code) < 0) watch.push(code);
      renderChips();
      row.remove();
      $('pickSearch').value = '';
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.pick-search')) $('pickResults').classList.add('hide');
    });

    // 模式切换
    document.querySelectorAll('.mode-item').forEach(function (el) {
      el.onclick = function () { setMode(el.getAttribute('data-mode')); };
    });

    // 添加预设策略
    $('addPreset').onclick = function () { openPresetDialog(); };

    $('go').addEventListener('click', start);
  }

  function start() {
    var d = $('startDate').value;
    if (!d) return U.toast('请选择起点日期');
    if (!watch.length) return U.toast('至少保留一只自选股');
    var wan = Math.max(1, Number($('capital').value) || 0);
    if (!wan) return U.toast('请输入有效本金');
    if ((MODE === 'both' || MODE === 'auto') && !PRESETS.some(function (p) { return p.enabled; })) {
      return U.toast('请至少启用一条自动策略预设');
    }
    if (existing && !confirm('当前已有一份进行中的复盘，开始新的复盘会覆盖它。确定继续？')) return;

    E.clear();
    var session = E.create({ startDate: d, capital: wan * 10000, watch: watch });
    // 存模式和预设到 session（review 页启动时读出来跑）
    session._mode = MODE;
    var endDate = M.meta().endDate;
    session._presetStrats = PRESETS.filter(function (p) { return p.enabled; }).map(function (p) {
      p.plan.start = d;
      p.plan.end = endDate;
      p.plan.capital = wan * 10000;
      p.plan.codes = (p.plan.codes && p.plan.codes.length ? p.plan.codes : watch).filter(function (c) {
        return watch.indexOf(c) >= 0;
      });
      if (!p.plan.codes.length) p.plan.codes = watch.slice();
      return { plan: p.plan, color: p.color };
    });
    E.save();

    if (MODE === 'auto') {
      location.href = 'review.html';
    } else {
      location.href = 'terminal.html';
    }
  }
})();
