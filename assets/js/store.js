/* 本地会话存储 */
window.SB = window.SB || {};
SB.store = (function () {
  var KEY = 'snowball.session.v1';
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }
  return { KEY: KEY, save: save, load: load, clear: clear };
})();
