/* 本地会话存储 */
window.SB = window.SB || {};
SB.store = (function () {
  var KEY = 'snowball.session.v1';
  var SLOT_KEY = 'snowball.slots.v1';
  var SLOT_MAX = 10;

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

  /* 10 档存档：空档为 null */
  function slots() {
    var out = [], raw = null;
    try { raw = localStorage.getItem(SLOT_KEY); } catch (e) { raw = null; }
    var arr = [];
    try { arr = raw ? JSON.parse(raw) : []; } catch (e) { arr = []; }
    if (!arr || !arr.length) arr = [];
    for (var i = 0; i < SLOT_MAX; i++) out.push(arr[i] || null);
    return out;
  }
  function writeSlots(arr) {
    try { localStorage.setItem(SLOT_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ }
  }
  function putSlot(i, data) {
    var arr = slots();
    arr[i] = data;
    writeSlots(arr);
  }
  function dropSlot(i) {
    var arr = slots();
    arr[i] = null;
    writeSlots(arr);
  }

  return {
    KEY: KEY, SLOT_KEY: SLOT_KEY, SLOT_MAX: SLOT_MAX,
    save: save, load: load, clear: clear,
    slots: slots, putSlot: putSlot, dropSlot: dropSlot
  };
})();
