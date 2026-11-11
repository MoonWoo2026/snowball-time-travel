/* 首页：数据概览、会话入口与新人指引 */
(function () {
  'use strict';
  var U = SB.ui;

  var GUIDE_KEY = 'sb_guide_v1';
  var STEPS = [
    {
      t: '选一个过去的时点，定本金',
      p: '在「新建复盘」里挑一个历史日期作为起点，设定本金和自选股。从这一刻起，你只能看到当时已经披露的财报与行情。',
      li: [
        '股票池包含 A 股、港股与 SPY，可在搜索框里随时加入自选。',
        '第一次建议用默认 7 只、200 万本金，从 2018 年附近开始。',
        '没有注册，进度只保存在本机浏览器。'
      ],
      tip: '先想清楚这笔钱在现实中能放多久，再决定起点和仓位。'
    },
    {
      t: '看时点数据，做第一笔决策',
      p: '进入交易终端后，右侧是「时点估值」：PB、PE、股息率、ROE 与近 1/3/5 年 ROE；下方是已披露财报与成长图表。',
      li: [
        '底部输入股数，或点 5% / 10% / 25% / 全仓快速下单。',
        'A 股 100 股/手，港股 1 股/手，SPY 1 股/手。',
        '主图可叠加上证指数虚线，对比个股与大盘。'
      ],
      tip: '先看估值处在历史什么位置，再决定买多少，不要一次打光现金。'
    },
    {
      t: '推进时间，让真实事件结算',
      p: '用「+1 月 / +3 月 / +1 年」推进时间。分红、送转、拆股、汇率与红利税都会按真实除权日结算。',
      li: [
        '每一笔买卖都会记账，可撤销最近 20 步，撤销不会倒退日期。',
        '持仓、成交、分红分别在下方三个标签页里。',
        '想重来一次，可在新建复盘时覆盖当前进度。'
      ],
      tip: '一年一年推进，比一次跳到终点更有复盘价值。'
    },
    {
      t: '复盘：不只看总收益',
      p: '复盘页会给出累计收益、年化、最大回撤、分红，以及新加的「分年度收益」看板。',
      li: [
        '对照「等权买入持有」基准，看自己是否真的跑赢。',
        '分年度看板会标出盈利年数、亏损年数、最佳与最差年份。',
        '主要操作、持仓、分红与成交明细全部留痕。'
      ],
      tip: '重点看超额收益与回撤，而不是单看某一年的总收益。'
    },
    {
      t: '进阶：自动策略与方案对比',
      p: '新建复盘时可以同时开启自动策略：定期定投（可设总额上限）或估值触发（PE / PB / 股息率 / ROE，任一或全部满足）。',
      li: [
        '自动策略使用独立账户，不影响你的手动操作。',
        '复盘页会把手动与自动两条曲线放在一起对比。',
        '需要保留多套方案时，用首页的「推演存档」。'
      ],
      tip: '先手动跑一轮，再用同一区间跑自动策略，对比自己的择时。'
    }
  ];

  var mask = null;
  var gi = 0;

  function seen() {
    try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
  }

  function buildGuide() {
    if (mask) return;
    mask = document.createElement('div');
    mask.className = 'guide-mask';
    mask.id = 'guideMask';
    mask.hidden = true;
    mask.innerHTML =
      '<div class="guide-card" role="dialog" aria-modal="true" aria-labelledby="gTitle">' +
        '<div class="g-head">' +
          '<div><span class="g-eyebrow">NEWCOMER GUIDE · 新人指引</span>' +
          '<h3 id="gTitle">用 5 分钟，学会时光雪球</h3></div>' +
          '<button type="button" class="g-close" id="gClose" aria-label="关闭指引">×</button>' +
        '</div>' +
        '<div class="g-body" id="gBody"></div>' +
        '<div class="g-foot">' +
          '<div class="g-dots" id="gDots"></div>' +
          '<div class="g-act">' +
            '<button type="button" class="g-btn" id="gPrev">上一步</button>' +
            '<button type="button" class="g-btn solid" id="gNext">下一步</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeGuide(true);
    });
    mask.querySelector('#gClose').addEventListener('click', function () { closeGuide(true); });
    mask.querySelector('#gPrev').addEventListener('click', function () {
      if (gi > 0) { gi--; drawGuide(); }
    });
    mask.querySelector('#gNext').addEventListener('click', function () {
      if (gi < STEPS.length - 1) {
        gi++; drawGuide();
      } else {
        closeGuide(true);
        location.href = 'setup.html';
      }
    });
    mask.querySelector('#gDots').addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') return;
      gi = Number(e.target.getAttribute('data-i')) || 0;
      drawGuide();
    });
    document.addEventListener('keydown', function (e) {
      if (!mask || mask.hidden) return;
      if (e.key === 'Escape') closeGuide(true);
      else if (e.key === 'ArrowRight' && gi < STEPS.length - 1) { gi++; drawGuide(); }
      else if (e.key === 'ArrowLeft' && gi > 0) { gi--; drawGuide(); }
    });
  }

  function drawGuide() {
    var s = STEPS[gi];
    mask.querySelector('#gBody').innerHTML =
      '<div class="g-step">' +
        '<div class="g-no">STEP ' + (gi + 1) + ' / ' + STEPS.length + '</div>' +
        '<h4>' + s.t + '</h4>' +
        '<p>' + s.p + '</p>' +
        '<ul>' + s.li.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
        '<div class="g-tip"><b>提示</b> ' + s.tip + '</div>' +
      '</div>';
    mask.querySelector('#gDots').innerHTML = STEPS.map(function (_, i) {
      return '<button type="button" data-i="' + i + '" class="' + (i === gi ? 'on' : '') +
        '" aria-label="第 ' + (i + 1) + ' 步"></button>';
    }).join('');
    var prev = mask.querySelector('#gPrev');
    var next = mask.querySelector('#gNext');
    prev.style.visibility = gi === 0 ? 'hidden' : 'visible';
    next.textContent = gi === STEPS.length - 1 ? '开始一次复盘' : '下一步';
  }

  function openGuide() {
    buildGuide();
    gi = 0;
    drawGuide();
    mask.hidden = false;
    document.body.classList.add('g-open');
    setTimeout(function () { mask.querySelector('#gNext').focus(); }, 30);
  }

  function closeGuide(mark) {
    if (!mask) return;
    mask.hidden = true;
    document.body.classList.remove('g-open');
    if (mark) markSeen();
  }

  document.getElementById('ctaGuide').addEventListener('click', openGuide);

  /* 首次访问且没有进行中的复盘时，自动弹出一次 */
  var hasSession = !!SB.store.load();
  if (!hasSession && !seen()) setTimeout(openGuide, 600);

  SB.market.load().then(function () {
    var meta = SB.market.meta();
    SB.engine.init();
    var S = SB.engine.load();

    document.getElementById('dataEnd').textContent = meta.endDate;
    document.getElementById('hpStocks').textContent = meta.stocks.length + ' 只';
    document.getElementById('hpRange').textContent = meta.calendar[0] + ' → ' + meta.endDate;
    document.getElementById('hpDays').textContent = meta.calendar.length.toLocaleString('en-US') + ' 个';
    document.getElementById('ctaSlots').addEventListener('click', function () { U.slotsDialog(); });

    if (S) {
      var m = SB.engine.metrics();
      document.getElementById('ctaResume').classList.remove('hide');
      document.getElementById('ctaStart').textContent = '重新开始';
      document.getElementById('hpState').textContent = '进行中的复盘';
      document.getElementById('hpTotalLabel').textContent = S.date + ' 总资产';
      var total = document.getElementById('hpTotal');
      total.textContent = U.money(m.total);
      total.className = U.cls(m.ret);
      U.header('home');
    } else {
      document.getElementById('hpTotal').textContent = '¥200万';
      U.header('home');
    }
  }).catch(function (e) {
    U.loadFail(e);
  });
})();
