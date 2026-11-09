/* 新建复盘：时点、本金、自选股 */
(function () {
  'use strict';
  var U = SB.ui, M = SB.market, E = SB.engine;
  var watch = [];
  var existing = null;

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

  function bind() {
    $('capital').addEventListener('input', updateCap);

    $('pickChips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rm]');
      if (!btn) return;
      watch = watch.filter(function (c) { return c !== btn.getAttribute('data-rm'); });
      renderChips();
    });

    $('pickSearch').addEventListener('input', function () {
      renderResults(this.value.trim());
    });
    $('pickSearch').addEventListener('focus', function () {
      renderResults(this.value.trim());
    });
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

    $('go').addEventListener('click', start);
  }

  function start() {
    var d = $('startDate').value;
    if (!d) return U.toast('请选择起点日期');
    if (!watch.length) return U.toast('至少保留一只自选股');
    var wan = Math.max(1, Number($('capital').value) || 0);
    if (!wan) return U.toast('请输入有效本金');
    if (existing && !confirm('当前已有一份进行中的复盘，开始新的复盘会覆盖它。确定继续？')) return;

    E.clear();
    E.create({ startDate: d, capital: wan * 10000, watch: watch });
    location.href = 'terminal.html';
  }
})();
