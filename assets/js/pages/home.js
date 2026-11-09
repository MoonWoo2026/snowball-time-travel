/* 首页：数据概览与会话入口 */
(function () {
  'use strict';
  var U = SB.ui;

  SB.market.load().then(function () {
    var meta = SB.market.meta();
    SB.engine.init();
    var S = SB.engine.load();

    document.getElementById('dataEnd').textContent = meta.endDate;
    document.getElementById('hpStocks').textContent = meta.stocks.length + ' 只';
    document.getElementById('hpRange').textContent = meta.calendar[0] + ' → ' + meta.endDate;
    document.getElementById('hpDays').textContent = meta.calendar.length.toLocaleString('en-US') + ' 个';

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
      document.getElementById('hpTotal').textContent = '¥180万';
      U.header('home');
    }
  }).catch(function (e) {
    U.toast('数据加载失败：' + e.message);
  });
})();
