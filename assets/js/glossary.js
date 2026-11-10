/* 术语解释表 */
var GLOSSARY = {
  qfq: '<b>前复权</b>：以「今天」的价格为基准，把历史价格按分红、送股等事件往下调整，让 K 线在除息日没有假跳空缺口。优点是 K 线连续、涨跌幅和均线准确；缺点是每次新分红后历史价格会变动，和当年真实成交价对不上。',
  raw: '<b>不复权</b>：显示当天真实成交价，什么都不调。优点是能看到历史真实价格；缺点是除息日有假缺口，拿「2016 年的 300 元」和「今天的 1500 元」直接比会低估真实涨幅（因为没算分红）。',
  cagr: '<b>年化收益 CAGR</b>：把一段时期的总收益率换算成「每年平均」的复利增长速度。公式：(期末净值 / 期初净值)^(1/年数) − 1。比如 5 年涨了 80%，年化约 12.5%。',
  from_buy: '<b>从首次买入算</b>：把「首次买入日」而不是复盘起始日作为收益计算的起点，等待期的时间不计入年化。用来判断你实际投入资金后的效率，而不是等了多久才买。',
  total_ret: '<b>累计收益</b>：期末总资产 ÷ 初始本金 − 1。全程口径，从复盘起始日开始算。',
  pb: '<b>市净率 PB</b>：股价 ÷ 每股净资产。PB < 1 俗称「破净」，常见于银行、周期股；高 PB 意味着市场给了高成长预期。每天用「当日之前已披露的最近一期财报」计算。',
  pe_ttm: '<b>PE(TTM)</b>：股价 ÷ 最近四个季度的每股收益。TTM = Trailing Twelve Months（过去 12 个月），用滚动四个季度消除单季度季节性。比静态 PE 更准确。',
  pe_static: '<b>静态 PE</b>：股价 ÷ 上一年度年报每股收益。简单但滞后——如果公司年报出来后利润变化很大，静态 PE 会严重失真。建议主要看 TTM。',
  roe: '<b>ROE 净资产收益率</b>：净利润 ÷ 平均股东权益，衡量公司用股东的钱赚钱的能力。长期高 ROE（>15%）通常意味着好的商业模式。',
  div_yield: '<b>股息率</b>：过去 12 个月公司派的现金 ÷ 当前股价。高股息率（>4%）通常意味着公司成熟稳定、分红慷慨，也可能是股价跌了很多导致分母变小。',
  deduct: '<b>扣非净利润</b>：从净利润中剔除非经常性损益（如政府补贴、出售资产、公允价值变动）后的利润。更能反映公司主营业务真实的盈利能力。',
  eps: '<b>EPS 每股收益</b>：归母净利润 ÷ 总股本。是 PE 估值的分母，也是公司赚钱能力最直观的指标之一。',
  compound: '<b>复利</b>：利息/利润也继续生息/生利，像滚雪球越滚越大。A股长期实际年化约 10%，巴菲特约 20%，差距全在复利的「滚」上。',
  benchmark: '<b>等权买入基准</b>：在同一天把所有自选股平均买入，之后什么都不做，持有到期。用来和你的主动操作对比，判断你是否跑赢了「什么都不做」。',
  excess: '<b>超额收益</b>：你的年化收益 − 基准年化收益。正数跑赢，负数跑输。超额为正是主动管理的核心目标。',
  sharpe: '<b>夏普比率</b>：(年化收益 − 无风险利率) ÷ 年化波动率。每承受 1 份波动风险能换来多少超额收益，越高越好。无风险利率取 3%（十年期国债）。',
  mdd: '<b>最大回撤</b>：净值曲线从最高点跌到最低点的最大跌幅。衡量最坏情况下你的账户会亏到什么程度。心理承受能力直接决定能扛住多大回撤。',
  turnover: '<b>换手率</b>：一段时期内成交金额 ÷ 平均总资产 × 2。反映交易频率，年化 2 倍 = 平均每半年全仓换一次手。换手率过高通常意味着频繁交易。',
  winrate: '<b>胜率</b>：盈利交易笔数 ÷ 总交易笔数。注意胜率高不一定赚得多——可能是小赚大亏的结构。',
  pl_ratio: '<b>盈亏比</b>：平均每笔盈利 ÷ 平均每笔亏损（取绝对值）。好的策略盈亏比通常 > 2，配合 40% 左右胜率就能赚钱。',
  index_sh: '<b>上证指数</b>：上海证券交易所上市的全部 A 股的价格指数，反映大盘整体涨跌。在这里作为宽基参考，不参与你的账户计算。',
  god_view: '<b>上帝视角</b>：用 K 线下方的「标注」按钮，找出某只股票历史上估值低于阈值（如 PB ≤ 0.9）的区间。区间内最低点用金色圆点标出，方便研究「历史上它便宜的时候是啥样」。估值严格用当时已披露的财报数据。',
  growth: '<b>成长能力</b>：公司营收、利润随时间的增长趋势。切换「按季度」看季节性和短期波动，切换「按年度」看长期趋势。'
};

/* 严格惯例：hover 120ms 后才弹，离开 180ms 后才关，同一时刻只显示一个，ESC/点空白全关 */
(function () {
  var OPEN = null;
  var ENTER_D = 120, LEAVE_D = 180;
  var tEnter = null, tLeave = null;

  function closeAll() {
    document.querySelectorAll('.term.pop-on').forEach(function (e) { e.classList.remove('pop-on'); });
    OPEN = null;
    clearTimeout(tEnter); clearTimeout(tLeave);
  }

  function show(el) {
    if (OPEN === el) return;
    closeAll();
    el.classList.add('pop-on');
    OPEN = el;
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.term[data-term]').forEach(function (el) {
      var key = el.getAttribute('data-term');
      var html = GLOSSARY[key];
      if (!html) return;
      // 确保有 pop 容器（幂等，已存在就不重建）
      if (!el.querySelector('.info-pop')) {
        var pop = document.createElement('span');
        pop.className = 'info-pop';
        pop.innerHTML = html;
        el.appendChild(pop);
      }
      // 去掉 CSS :hover 的冲突（加一行 !important 式处理：用 JS 完全接管）
      el.addEventListener('mouseenter', function () {
        clearTimeout(tLeave);
        clearTimeout(tEnter);
        tEnter = setTimeout(function () { show(el); }, ENTER_D);
      });
      el.addEventListener('mouseleave', function () {
        clearTimeout(tEnter);
        tLeave = setTimeout(function () {
          if (OPEN === el) { el.classList.remove('pop-on'); OPEN = null; }
        }, LEAVE_D);
      });
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (OPEN === el) { el.classList.remove('pop-on'); OPEN = null; }
        else { show(el); }
      });
    });

    document.addEventListener('click', function (e) {
      if (OPEN && !OPEN.contains(e.target)) closeAll();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  });
})();
