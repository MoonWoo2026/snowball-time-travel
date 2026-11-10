/* 新建复盘：时点、本金、自选股、运行模式 + 策略预设 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var watch = [];
  var existing = null;

  /* 运行模式 */
  var MODE = 'manual';              // manual | both | auto
  var PRESETS = [];                 // [{plan, enabled, color}]
  var CURVE_COLORS = ['#6B8FB8', '#8B6E5A', '#4A8F6A', '#A57989'];

  /* 三套经典模板 */
  var TEMPLATES = [
    { label: '每月定投 ¥2 万 + 季度再平衡', make: function (ctx) { return { type:'dca', name:'每月定投 ¥2 万', dcaPeriod:'month', dcaAmount:20000, rebalPeriod:'quarter', capital: ctx.capital, codes: ctx.codes.slice() }; } },
    { label: '季度定投 ¥5 万 + PB ≤1.0 买/≥2.0 卖', make: function (ctx) { return { type:'dca', name:'季度定投 ¥5 万', dcaPeriod:'quarter', dcaAmount:50000, tpPct:null, slPct:null, holdDays:null, capital: ctx.capital, codes: ctx.codes.slice() }; } },
    { label: 'PB ≤0.9 低估买入 / PB ≥1.8 高估卖出', make: function (ctx) { return { type:'value', name:'PB ≤0.9 低估买入', valMetric:'pb', valBuy:0.9, valAmount:50000, valSell:1.8, capital: ctx.capital, codes: ctx.codes.slice() }; } }
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
    var saved = E.session() && E.session()._presetStrats;
    if (saved && saved.length) {
      PRESETS = saved.slice(0, 4);
      var savedMode = E.session()._mode;
      if (savedMode) setMode(savedMode);
    }

    bind();
  }).catch(function (e) {
    U.toast('数据加载失败：' + e.message);
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
      if (p.rebalPeriod) s += '，' + (p.rebalPeriod === 'month' ? '每月' : p.rebalPeriod === 'quarter' ? '每季度' : '每年') + '再平衡';
      return s;
    }
    var metric = (p.valMetric || 'pb').toUpperCase();
    var s = metric + ' ≤ ' + p.valBuy + ' 买入 ¥' + (p.valAmount || 0).toLocaleString();
    if (p.valSell) s += ' / ' + metric + ' ≥ ' + p.valSell + ' 卖出';
    return s;
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
      dcaPeriod: 'month', dcaAmount: 20000, rebalPeriod: null,
      valMetric: 'pb', valBuy: 1.0, valAmount: 50000, valSell: null,
      tpPct: null, tpMode: 'full', slPct: null, holdDays: null,
      name: ''
    };
  }

  function openPresetDialog(idx) {
    if (watch.length < 1) return U.toast('请先选至少一只自选股');
    if (!M.stock('600036')) return U.toast('数据尚未加载，请稍等');
    var editing = idx != null;
    var plan = editing ? JSON.parse(JSON.stringify(PRESETS[idx].plan)) : newPlan();

    // 简易弹窗：单条策略配置（内嵌在 setup 页里，比 review 弹窗稍简化）
    var mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML =
      '<div class="modal strat-modal">' +
        '<h4>' + (editing ? '编辑策略' : '添加自动策略') + '</h4>' +
        '<label>策略类型' +
          '<div class="seg" id="ptType">' +
            '<button data-t="dca" class="' + (plan.type==='dca'?'on':'') + '">等权定投</button>' +
            '<button data-t="value" class="' + (plan.type==='value'?'on':'') + '">估值触发</button>' +
          '</div>' +
        '</label>' +
        '<div class="s-row"><label>曲线名 <input id="ptName" value="' + U.esc(plan.name || '') + '" placeholder="比如 每月定投 ¥2 万"></label></div>' +
        '<div class="s-row pt-dca" style="' + (plan.type==='dca'?'':'display:none') + '">' +
          '<label>周期 <select id="ptPeriod">' +
            '<option value="week"' + (plan.dcaPeriod==='week'?' selected':'') + '>每周</option>' +
            '<option value="month"' + (plan.dcaPeriod==='month'?' selected':'') + '>每月</option>' +
            '<option value="quarter"' + (plan.dcaPeriod==='quarter'?' selected':'') + '>每季度</option>' +
          '</select></label>' +
          '<label>每期总金额（CNY）<input id="ptAmount" type="number" value="' + (plan.dcaAmount||20000) + '" step="1000"></label>' +
          '<label class="thin">定期再平衡 <select id="ptRebal" style="width:110px">' +
            '<option value="">关闭</option>' +
            '<option value="month"' + (plan.rebalPeriod==='month'?' selected':'') + '>每月</option>' +
            '<option value="quarter"' + (plan.rebalPeriod==='quarter'?' selected':'') + '>每季度</option>' +
            '<option value="year"' + (plan.rebalPeriod==='year'?' selected':'') + '>每年</option>' +
          '</select><span class="k tiny">把持仓卖回到等权重</span></label>' +
        '</div>' +
        '<div class="s-row pt-value" style="' + (plan.type==='value'?'':'display:none') + '">' +
          '<label>估值指标 <select id="ptMetric">' +
            '<option value="pb"' + (plan.valMetric==='pb'?' selected':'') + '>PB（市净率）</option>' +
            '<option value="pe"' + (plan.valMetric==='pe'?' selected':'') + '>PE(TTM)</option>' +
          '</select></label>' +
          '<label>买入阈值 ≤ <input id="ptBuy" type="number" value="' + (plan.valBuy||1.0) + '" step="0.1"></label>' +
          '<label>每次买入金额 <input id="ptValAmount" type="number" value="' + (plan.valAmount||50000) + '" step="1000"></label>' +
          '<label class="thin">估值止盈（≥ 全清）<input id="ptValSell" type="number" value="' + (plan.valSell||'') + '" placeholder="留空=关闭"></label>' +
        '</div>' +
        '<div class="sell-block">' +
          '<div class="sell-head">卖出规则（留空=不触发）</div>' +
          '<div class="s-row">' +
            '<label>目标收益率止盈 <input id="ptTpPct" type="number" step="5" value="' + (plan.tpPct ? Math.round(plan.tpPct*100) : '') + '" placeholder="如 30 → 30%"></label>' +
            '<label>止盈方式 <select id="ptTpMode">' +
              '<option value="full"' + (plan.tpMode!=='part'?' selected':'') + '>一次性全清</option>' +
              '<option value="part"' + (plan.tpMode==='part'?' selected':'') + '>分批（1/3 起步）</option>' +
            '</select></label>' +
            '<label class="thin">止损（浮亏 ≥）<input id="ptSlPct" type="number" step="5" value="' + (plan.slPct ? Math.round(plan.slPct*100) : '') + '" placeholder="如 15 → 15%"></label>' +
            '<label class="thin">持有期到期（天）<input id="ptHoldDays" type="number" step="30" value="' + (plan.holdDays||'') + '" placeholder="如 365"></label>' +
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
    mask.querySelector('#ptCancel').onclick = function () { mask.remove(); };
    mask.querySelector('.modal').onclick = function (e) { e.stopPropagation(); };
    mask.onclick = function () { mask.remove(); };

    mask.querySelector('#ptSave').onclick = function () {
      var t = mask.querySelector('#ptType button.on').getAttribute('data-t');
      plan.type = t;
      plan.name = mask.querySelector('#ptName').value.trim() || (t === 'dca' ? '等权定投' : '估值触发');
      plan.start = $('startDate').value;
      plan.capital = getCapital();
      plan.codes = watch.slice();
      if (t === 'dca') {
        plan.dcaPeriod = mask.querySelector('#ptPeriod').value;
        plan.dcaAmount = +mask.querySelector('#ptAmount').value || 10000;
        plan.rebalPeriod = mask.querySelector('#ptRebal').value || null;
      } else {
        plan.valMetric = mask.querySelector('#ptMetric').value;
        plan.valBuy = +mask.querySelector('#ptBuy').value || 1;
        plan.valAmount = +mask.querySelector('#ptValAmount').value || 20000;
        var vs = mask.querySelector('#ptValSell').value;
        plan.valSell = vs ? +vs : null;
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
        // 自动填好名（第一次）
        if (PRESETS.length === 0 && !mask.querySelector('#ptName').value) {
          plan.name = t === 'dca' ? (plan.dcaPeriod === 'week' ? '每周定投 ¥' : plan.dcaPeriod === 'month' ? '每月定投 ¥' : '每季度定投 ¥') + plan.dcaAmount.toLocaleString() : '估值触发';
        }
        PRESETS.push({ plan: plan, enabled: true, color: CURVE_COLORS[PRESETS.length] });
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
      p.plan.codes = watch.slice();
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
