/*
 * DBX 插件适配层（在游戏主脚本之前加载）。
 *
 * 游戏是标准网页应用，依赖 localStorage 存自动存档、设置与成就。DBX 插件 UI 跑在
 * opaque-origin 沙箱里，**访问 localStorage 会直接抛错**，所以这里提供一份内存实现，
 * 并在背后用 `host.storage`（插件专属的持久化键值存储）落盘。
 *
 * 这样游戏源码一行都不用改：它的存档逻辑本来就有"服务器不可用 → 存本地"的兜底，
 * 而我们让 `/api/*` 请求自然失败（沙箱里连不出去），于是存档就落到了 localStorage 上，
 * 再由本文件同步进 DBX 的存储里。
 */
(function () {
  var STORAGE_KEY = "gongfa:localStorage";
  var PLUGIN = window.dbxPlugin;
  var storage =
    PLUGIN && PLUGIN.storage && PLUGIN.capabilities && PLUGIN.capabilities.storage
      ? PLUGIN.storage
      : null;

  var data = {};
  var saveTimer = 0;
  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  /* ── rAF 门闸：伪装时冻结渲染循环 ───────────────────────────────────── *
   *
   * 游戏靠 requestAnimationFrame 驱动绘制。伪装层盖上以后没人看画面，
   * 但循环还在跑 —— 笔记本上白耗 CPU 和电。这里在适配层把 rAF 挂起：
   * 期间的帧回调先排队，恢复时按序补发（补发的那一次会自己再排下一帧，
   * 循环就自然接上了）。不是丢弃回调，否则游戏循环会彻底停死。
   */
  var rafPaused = false;
  var rafQueue = [];
  var nativeRaf =
    typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : null;

  var rafStats = { delivered: 0, queued: 0 };
  window.__gongfaRaf = rafStats;

  if (nativeRaf) {
    window.requestAnimationFrame = function (callback) {
      if (!rafPaused) {
        rafStats.delivered += 1;
        return nativeRaf(callback);
      }
      rafStats.queued += 1;
      rafQueue.push(callback);
      if (rafQueue.length > 64) rafQueue.shift();
      return -1;
    };
  }

  function pauseRaf() {
    if (!nativeRaf || rafPaused) return;
    rafPaused = true;
  }

  function resumeRaf() {
    if (!nativeRaf || !rafPaused) return;
    rafPaused = false;
    var queued = rafQueue;
    rafQueue = [];
    for (var i = 0; i < queued.length; i += 1) {
      nativeRaf(queued[i]);
    }
  }

  function scheduleSave() {
    if (!storage) return;
    if (saveTimer) clearTimeout(saveTimer);
    // 存一次要序列化整个键值表，合并成一次写，别在游戏里每次 setItem 都写盘。
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      flush();
    }, 400);
  }

  function flush() {
    if (!storage) return Promise.resolve();
    var snapshot = {};
    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) snapshot[key] = data[key];
    }
    return Promise.resolve(storage.set(STORAGE_KEY, snapshot)).catch(function () {
      return null;
    });
  }

  /* ── localStorage 实现 ─────────────────────────────────────────────── */

  var localStorageShim = {
    getItem: function (key) {
      var value = data[String(key)];
      return value === undefined ? null : value;
    },
    setItem: function (key, value) {
      data[String(key)] = String(value);
      scheduleSave();
    },
    removeItem: function (key) {
      delete data[String(key)];
      scheduleSave();
    },
    clear: function () {
      data = {};
      scheduleSave();
    },
    key: function (index) {
      var keys = Object.keys(data);
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    get length() {
      return Object.keys(data).length;
    }
  };

  function installLocalStorage() {
    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get: function () {
          return localStorageShim;
        }
      });
      // 验证一下真的生效了（有些环境是只读访问器）
      if (window.localStorage === localStorageShim) return true;
    } catch (error) {
      /* 继续尝试下一种方式 */
    }
    try {
      delete window.localStorage;
      window.localStorage = localStorageShim;
      return window.localStorage === localStorageShim;
    } catch (error) {
      return false;
    }
  }

  var installed = installLocalStorage();

  /* ── 拦掉后端请求 ──────────────────────────────────────────────────── *
   *
   * 插件里没有游戏服务器（存档/排行榜/局域网都不是沙箱能做的事）。
   * 如果放它去请求 http://127.0.0.1:3000，控制台会刷一堆 CSP 违规；这里直接
   * 用一个干净的"离线"错误回绝，游戏自己的 catch 会走本地兜底：
   *   · 保存 → "服务器不可用，已保存到本地"（确实存在 localStorage 里）
   *   · 读档 → 回落到本地自动存档
   *   · 排行榜 → "离线模式：排行榜不可用"
   */
  var nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/") !== -1) {
      return Promise.reject(new Error("offline: DBX 插件内没有游戏服务器"));
    }
    if (nativeFetch) return nativeFetch(input, init);
    return Promise.reject(new Error("fetch unavailable"));
  };

  /* ── 与宿主存储同步 ────────────────────────────────────────────────── */

  if (storage) {
    Promise.resolve(storage.get(STORAGE_KEY))
      .then(function (saved) {
        if (saved && typeof saved === "object") {
          for (var key in saved) {
            if (Object.prototype.hasOwnProperty.call(saved, key)) data[key] = String(saved[key]);
          }
        }
      })
      .catch(function () {
        /* 读失败就用空表，不影响游戏开始 */
      })
      .then(function () {
        readyResolve(true);
      });
    // 切后台/关面板前把没落盘的写掉。
    if (document && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) flush();
      });
    }
    if (typeof window.addEventListener === "function") {
      window.addEventListener("blur", function () {
        flush();
      });
    }
  } else {
    readyResolve(false);
  }

  /* ── 存储不可用时的提示 ────────────────────────────────────────────── */

  function showBanner() {
    if (!installed || storage) return;
    try {
      var el = document.createElement("div");
      el.textContent = "⚠ 存档只在本次会话有效：当前环境没有 host.storage 权限（在 DBX 中运行即可持久保存）";
      el.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:70vw;padding:8px 12px;" +
        "border-radius:8px;background:rgba(15,23,42,.92);color:#fde68a;font:12px/1.5 system-ui,sans-serif;" +
        "box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none";
      document.addEventListener("DOMContentLoaded", function () {
        document.body.appendChild(el);
        setTimeout(function () {
          el.remove();
        }, 12000);
      });
    } catch (error) {
      /* 提示失败无所谓 */
    }
  }

  /* ── 本地局域网联机 ────────────────────────────────────────────────── *
  /* ── 本地局域网联机 ────────────────────────────────────────────────── *
   *
   * 游戏中继协议的通道原本是 WebSocket，但两边限制不同：
   *   · 插件 UI 在 sandbox 里连不了本机端口（CSP 只放行声明过的 https）→ 走宿主 RPC；
   *   · 手机打开的是 sidecar 托管的页面 → 直接用 SSE 下行 + POST 上行。
   * 下面给 WebSocket 做一个替身：只接管 .../relay，其它地址原样交给浏览器。
   */
  var RELAY_PATH = "/relay";
  var relaySockets = {};
  var relaySocketSeq = 0;

  function relayHttpBase(wsUrl) {
    return wsUrl.replace(/^ws/, "http").replace(/\/relay(\?.*)?$/, "");
  }

  // 宿主 API 要动态取：宿主可能晚于适配层注入，早绑定会拿到 undefined。
  function pluginApi() {
    var api = window.dbxPlugin;
    return api && typeof api.invoke === "function" ? api : null;
  }

  // 判据只有一个：有没有宿主 API（dev host 的 UI 是 http 源，手机打开的中继页面拿不到 dbxPlugin）。
  function isPluginSandbox() {
    return !!pluginApi();
  }

  function RelaySocket(url) {
    var self = this;
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.id = "relay-" + (relaySocketSeq += 1) + "-" + Math.random().toString(36).slice(2, 7);
    relaySockets[this.id] = this;

    if (isPluginSandbox()) {
      Promise.resolve(pluginApi().invoke("lan/wsOpen", { id: this.id, name: "房主" }))
        .then(function () {
          self.readyState = 1;
          self.startPolling();
          if (self.onopen) self.onopen({});
        })
        .catch(function (error) {
          self.readyState = 3;
          delete relaySockets[self.id];
          if (self.onerror) self.onerror({ message: String((error && error.message) || error) });
          if (self.onclose) self.onclose({});
        });
      return;
    }

    var stream = new EventSource(relayHttpBase(url) + "/relay/events?c=" + encodeURIComponent(this.id));
    this.stream = stream;
    stream.addEventListener("hello", function () {
      self.readyState = 1;
      if (self.onopen) self.onopen({});
    });
    stream.onmessage = function (event) {
      if (self.onmessage) self.onmessage({ data: event.data });
    };
    stream.onerror = function () {
      if (self.readyState === 1) {
        self.readyState = 3;
        if (self.onclose) self.onclose({});
      } else if (self.onerror) {
        self.onerror({ message: "连不上联机中继" });
      }
    };
  }

  /** 轮询取消息：比依赖宿主事件更可靠，且天然不会重复投递。 */
  RelaySocket.prototype.startPolling = function () {
    var self = this;
    if (this.pollTimer) return;
    this.pollTimer = setInterval(function () {
      if (self.readyState !== 1) return;
      Promise.resolve(pluginApi().invoke("lan/poll", { id: self.id }))
        .then(function (result) {
          var messages = (result && result.messages) || [];
          for (var i = 0; i < messages.length; i += 1) {
            if (self.onmessage) self.onmessage({ data: messages[i] });
          }
        })
        .catch(function () {
          return null;
        });
    }, 120);
  };

  RelaySocket.prototype.send = function (text) {
    if (this.readyState !== 1) return;
    if (isPluginSandbox()) {
      Promise.resolve(pluginApi().invoke("lan/wsSend", { id: this.id, data: String(text) })).catch(function () {
        return null;
      });
      return;
    }
    var message;
    try {
      message = JSON.parse(String(text));
    } catch (error) {
      return;
    }
    fetch(relayHttpBase(this.url) + "/relay/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: this.id, msg: message })
    }).catch(function () {
      return null;
    });
  };

  RelaySocket.prototype.close = function () {
    this.readyState = 3;
    delete relaySockets[this.id];
    if (isPluginSandbox()) {
      Promise.resolve(pluginApi().invoke("lan/wsClose", { id: this.id })).catch(function () {
        return null;
      });
    } else if (this.stream) {
      this.stream.close();
    }
    if (this.onclose) this.onclose({});
  };

  if (typeof window.WebSocket === "function") {
    var NativeWebSocket = window.WebSocket;
    var RelayWebSocket = function (url) {
      var target = String(url || "");
      if (target.indexOf(RELAY_PATH) !== -1) return new RelaySocket(target);
      return new NativeWebSocket(url);
    };
    RelayWebSocket.prototype = NativeWebSocket.prototype;
    RelayWebSocket.CONNECTING = 0;
    RelayWebSocket.OPEN = 1;
    RelayWebSocket.CLOSING = 2;
    RelayWebSocket.CLOSED = 3;
    window.WebSocket = RelayWebSocket;
  }

  // 注：联机的下行消息只走 lan/poll 轮询，不用宿主事件 —— 事件通道在部分宿主上会静默丢弃，
  // 而且 manifest 并没有声明 host.events。留着这条死路径只会误导后来的人。
  showBanner();

  /* ═══════════════════════════════════════════════════════════════════════
   * 伪装主界面（老板键）
   *
   * 需求：热键切走、失去焦点自动切走，画面要像"一个正经的数据库工具"，
   * 不能出现游戏字样。这里整个界面由适配层自己画，游戏源码一行不改。
   *
   * 为什么热键默认是 Ctrl+Shift+Z：游戏自己占用了 Space（结束回合）、
   * Esc（取消选中）、Tab（切换区域）、方向键与 Ctrl+Z，这些都撞不得。
   * ═══════════════════════════════════════════════════════════════════════ */

  var COVER_KEY_SETTING = "gongfa-war.bossKey";
  var COVER_BLUR_SETTING = "gongfa-war.hideOnBlur";
  var COVER_KEEP_ON_FOCUS_SETTING = "gongfa-war.keepCoverOnFocus";
  var DEFAULT_BOSS_KEY = "ctrl+shift+z";
  var coverEl = null;
  var coverActive = false;
  var coverByBlur = false;
  /** 老板键录制中：下一次按键只用来设置热键 */
  var recording = false;
  var keyButtonRefresh = null;
  var audioContexts = [];

  // 记录所有 AudioContext，伪装时暂停它们（音效/音乐一起静音，且不丢状态）
  try {
    var NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    if (NativeAudioContext) {
      var WrappedAudioContext = function () {
        var context = new NativeAudioContext(...arguments);
        audioContexts.push(context);
        return context;
      };
      WrappedAudioContext.prototype = NativeAudioContext.prototype;
      if (window.AudioContext) window.AudioContext = WrappedAudioContext;
      if (window.webkitAudioContext) window.webkitAudioContext = WrappedAudioContext;
    }
  } catch (error) {
    /* 包装失败只是不能静音，不影响伪装 */
  }

  function readPref(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* 忽略 */
    }
  }

  function bossKeyCombo() {
    return String(readPref(COVER_KEY_SETTING, DEFAULT_BOSS_KEY)).toLowerCase();
  }

  function hideOnBlurEnabled() {
    return readPref(COVER_BLUR_SETTING, "1") !== "0";
  }

  /** 切回 DBX 时是否继续保持伪装（默认不保持：回来就露出游戏）。 */
  function keepCoverOnFocusEnabled() {
    return readPref(COVER_KEEP_ON_FOCUS_SETTING, "0") === "1";
  }

  /** 把按键事件转成 "ctrl+shift+z" 这种字符串；不成组合键就返回 null。 */
  function comboFromEvent(event) {
    var key = String(event.key || "").toLowerCase();
    var modifiers = [];
    if (event.ctrlKey) modifiers.push("ctrl");
    if (event.altKey) modifiers.push("alt");
    if (event.shiftKey) modifiers.push("shift");
    if (event.metaKey) modifiers.push("meta");

    if (key === "control" || key === "shift" || key === "alt" || key === "meta" || key === "escape") return null;
    if (!key) return null;
    if (key === " ") key = "space";
    // 至少一个修饰键，否则会把普通字母变成老板键
    if (modifiers.length === 0) return null;
    return modifiers.join("+") + "+" + key;
  }

  /** 事件是否命中配置的热键（例如 "ctrl+shift+h" 或 "alt+x"）。 */
  function matchesBossKey(event) {
    var parts = bossKeyCombo().split("+");
    var key = parts.pop();
    var needCtrl = parts.indexOf("ctrl") !== -1;
    var needShift = parts.indexOf("shift") !== -1;
    var needAlt = parts.indexOf("alt") !== -1;
    var needMeta = parts.indexOf("meta") !== -1;
    var pressed = String(event.key || "").toLowerCase();
    if (pressed !== key) return false;
    if (!!event.ctrlKey !== needCtrl) return false;
    if (!!event.shiftKey !== needShift) return false;
    if (!!event.altKey !== needAlt) return false;
    if (!!event.metaKey !== needMeta) return false;
    return true;
  }

  var COVER_ROWS = [
    ["1001", "ORD-24081", "paid", "1299.00", "2026-11-02 09:41:12"],
    ["1002", "ORD-24082", "paid", "268.50", "2026-11-02 09:43:07"],
    ["1003", "ORD-24083", "pending", "4880.00", "2026-11-02 09:55:31"],
    ["1004", "ORD-24084", "refunded", "99.00", "2026-11-02 10:02:44"],
    ["1005", "ORD-24085", "paid", "179.90", "2026-11-02 10:11:03"],
    ["1006", "ORD-24086", "shipped", "3299.00", "2026-11-02 10:18:26"],
    ["1007", "ORD-24087", "paid", "56.80", "2026-11-02 10:24:51"],
    ["1008", "ORD-24088", "cancelled", "749.00", "2026-11-02 10:31:18"],
    ["1009", "ORD-24089", "paid", "1288.00", "2026-11-02 10:39:02"],
    ["1010", "ORD-24090", "pending", "23.00", "2026-11-02 10:47:35"],
    ["1011", "ORD-24091", "paid", "458.00", "2026-11-02 10:52:09"],
    ["1012", "ORD-24092", "shipped", "992.00", "2026-11-02 11:03:47"],
    ["1013", "ORD-24093", "paid", "318.60", "2026-11-02 11:12:20"],
    ["1014", "ORD-24094", "paid", "66.00", "2026-11-02 11:19:58"],
  ];

  var COVER_STYLE_ID = "dbx-cover-style";
  var COVER_CSS = [
    "#dbx-cover{position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;",
    "background:#0f1115;color:#d4d4d8;font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}",
    "#dbx-cover .cv-bar{display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid #23262d;background:#14161b}",
    "#dbx-cover .cv-brand{font-weight:700;letter-spacing:.5px;color:#e4e4e7}",
    "#dbx-cover .cv-sep{color:#2f333c}",
    "#dbx-cover .cv-field{display:flex;align-items:center;gap:6px}",
    "#dbx-cover .cv-label{color:#71717a;font-size:12px}",
    "#dbx-cover .cv-select{background:#1b1e24;color:#d4d4d8;border:1px solid #2f333c;border-radius:5px;padding:3px 8px;font-size:12px}",
    "#dbx-cover .cv-search{background:#1b1e24;color:#d4d4d8;border:1px solid #2f333c;border-radius:5px;padding:4px 8px;font-size:12px;width:150px;outline:none}",
    "#dbx-cover .cv-search:focus{border-color:#3b82f6}",
    "#dbx-cover .cv-stat{color:#71717a;font-size:12px}",
    "#dbx-cover .cv-spacer{flex:1}",
    "#dbx-cover .cv-btn{display:flex;align-items:center;gap:6px;background:#1d4ed8;color:#fff;border:1px solid #2563eb;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}",
    "#dbx-cover .cv-btn:hover{background:#2563eb}",
    "#dbx-cover .cv-icon{background:transparent;color:#a1a1aa;border:1px solid transparent;border-radius:6px;padding:3px 8px;font-size:15px;cursor:pointer}",
    "#dbx-cover .cv-icon:hover{background:#1b1e24;color:#e4e4e7;border-color:#2f333c}",
    "#dbx-cover .cv-editor{display:flex;flex-direction:column;min-height:34%;border-bottom:1px solid #23262d;background:#12141a}",
    "#dbx-cover .cv-tabs{display:flex;gap:2px;padding:6px 10px 0;background:#14161b}",
    "#dbx-cover .cv-tab{padding:5px 12px;border-radius:6px 6px 0 0;font-size:12px;color:#8b8d96;background:transparent;border:1px solid transparent;border-bottom:none;cursor:pointer}",
    "#dbx-cover .cv-tab--active{color:#d4d4d8;background:#12141a;border-color:#2f333c}",
    "#dbx-cover .cv-code{display:flex;flex:1;min-height:0;background:#12141a}",
    "#dbx-cover .cv-gutter{padding:10px 8px 10px 12px;text-align:right;color:#3b414d;white-space:pre;",
    "font:12.5px/1.7 ui-monospace,Consolas,'Cascadia Mono',monospace;user-select:none;overflow:hidden;min-width:34px}",
    "#dbx-cover .cv-codebody{position:relative;flex:1;min-width:0}",
    "#dbx-cover .cv-hl{position:absolute;inset:0;margin:0;padding:10px 14px;overflow:hidden;white-space:pre;",
    "font:12.5px/1.7 ui-monospace,Consolas,'Cascadia Mono',monospace;color:#cfd3da;pointer-events:none;tab-size:2}",
    "#dbx-cover .cv-sql{position:absolute;inset:0;width:100%;height:100%;flex:none;box-sizing:border-box;resize:none;border:none;",
    "outline:none;background:transparent;color:transparent;caret-color:#e5e7eb;margin:0;white-space:pre;overflow:auto;",
    "padding:10px 14px;font:12.5px/1.7 ui-monospace,Consolas,'Cascadia Mono',monospace;tab-size:2}",
    "#dbx-cover .cv-sql::selection{background:#264f78}",
    "#dbx-cover .cv-hl .k{color:#7dd3fc}",
    "#dbx-cover .cv-hl .s{color:#86efac}",
    "#dbx-cover .cv-hl .c{color:#6b7280}",
    "#dbx-cover .cv-hl .n{color:#fca5a5}",
    "#dbx-cover .cv-hl .f{color:#c4b5fd}",
    "#dbx-cover .cv-result{flex:1;display:flex;flex-direction:column;min-height:0;background:#0f1115}",
    "#dbx-cover .cv-rhead{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid #23262d;background:#14161b}",
    "#dbx-cover .cv-rtitle{color:#d4d4d8;font-size:12px;font-weight:600}",
    "#dbx-cover .cv-rmeta{color:#71717a;font-size:11.5px}",
    "#dbx-cover .cv-tbtn{background:#1b1e24;color:#a1a1aa;border:1px solid #2f333c;border-radius:5px;padding:3px 9px;font-size:11.5px;cursor:pointer}",
    "#dbx-cover .cv-tbtn:hover{color:#e4e4e7;border-color:#3f3f46}",
    "#dbx-cover .cv-rbody{flex:1;overflow:auto}",
    "#dbx-cover table{width:100%;border-collapse:collapse;font:12px/1.65 ui-monospace,Consolas,monospace;color:#c7c9d1}",
    "#dbx-cover thead th{position:sticky;top:0;background:#16181d;color:#8b8d96;text-align:left;font-weight:600;padding:6px 12px;border-bottom:1px solid #2a2d35;z-index:1}",
    "#dbx-cover tbody td{padding:4px 12px;border-bottom:1px solid #1c1f26;white-space:nowrap}",
    "#dbx-cover tbody tr:nth-child(even){background:#12141a}",
    "#dbx-cover .cv-foot{display:flex;align-items:center;gap:12px;padding:5px 12px;border-top:1px solid #23262d;background:#14161b;color:#52525b;font-size:11.5px}",
    "#dbx-cover .cv-panel{position:absolute;top:46px;right:12px;width:290px;background:#18181b;border:1px solid #2f333c;border-radius:10px;",
    "box-shadow:0 16px 40px rgba(0,0,0,.5);padding:12px;z-index:2}",
    "#dbx-cover .cv-panel h4{margin:0 0 10px;font-size:12.5px;color:#e4e4e7}",
    "#dbx-cover .cv-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:12px;color:#a1a1aa}",
    "#dbx-cover .cv-key{width:130px;background:#1b1e24;color:#e4e4e7;border:1px solid #2f333c;border-radius:5px;padding:4px 7px;font:12px ui-monospace,Consolas,monospace;text-align:center;outline:none}",
    "#dbx-cover .cv-key:focus{border-color:#3b82f6}",
    "#dbx-cover .cv-hint{color:#71717a;font-size:11px;line-height:1.5;margin:-4px 0 10px}",
    "#dbx-cover .cv-play{width:100%;padding:7px;border-radius:7px;border:1px solid #2563eb;background:#1d4ed8;color:#fff;font-size:12.5px;cursor:pointer}",
    "#dbx-cover .cv-play:hover{background:#2563eb}",
    "#dbx-cover .cv-check{display:flex;align-items:center;gap:7px;font-size:12px;color:#a1a1aa;margin-bottom:8px}",
    "#dbx-cover .cv-check input{accent-color:#3b82f6}"
  ].join("");

  function ensureCoverStyle() {
    if (document.getElementById(COVER_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = COVER_STYLE_ID;
    style.textContent = COVER_CSS;
    document.head.appendChild(style);
  }

  var COVER_ON_START_SETTING = "gongfa-war.coverOnStart";

  function coverOnStartEnabled() {
    return readPref(COVER_ON_START_SETTING, "1") !== "0";
  }

  function formatTime() {
    var d = new Date();
    function pad(n) {
      return n < 10 ? "0" + n : String(n);
    }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function buildCover() {
    ensureCoverStyle();
    var root = document.createElement("div");
    root.id = "dbx-cover";

    var status = document.createElement("div");
    status.className = "cv-bar";

    var options = ["prod-mysql", "analytics-pg", "orders-ro"]
      .map(function (name) {
        return '<option value="' + name + '">' + name + "</option>";
      })
      .join("");

    status.innerHTML =
      '<span class="cv-brand">◧ DBX</span>' +
      '<span class="cv-sep">|</span>' +
      '<label class="cv-field"><span class="cv-label">连接</span>' +
      '<select class="cv-select" id="cv-conn">' + options + "</select></label>" +
      '<label class="cv-field"><span class="cv-label">数据库</span>' +
      '<select class="cv-select" id="cv-db"><option>shop</option><option>report</option></select></label>' +
      '<label class="cv-field"><span class="cv-label">检索</span>' +
      '<input class="cv-search" id="cv-search" type="search" spellcheck="false" placeholder="按状态 / 订单号检索" /></label>' +
      '<span class="cv-sep">|</span>' +
      '<span class="cv-stat" id="cv-status">就绪</span>' +
      '<span class="cv-spacer"></span>' +
      '<button class="cv-btn" type="button" id="cv-run">▶ 运行</button>' +
      '<button class="cv-icon" type="button" id="cv-gear" title="设置" aria-label="设置">⚙</button>';

    var editor = document.createElement("section");
    editor.className = "cv-editor";
    editor.innerHTML =
      '<div class="cv-tabs"><span class="cv-tab cv-tab--active">query-1.sql</span>' +
      '<span class="cv-tab">query-2.sql</span></div>' +
      '<div class="cv-code">' +
      '<div class="cv-gutter" id="cv-gutter" aria-hidden="true"></div>' +
      '<div class="cv-codebody">' +
      '<pre class="cv-hl" id="cv-hl" aria-hidden="true"></pre>' +
      '<textarea class="cv-sql" id="cv-sql" spellcheck="false" wrap="off" ' +
      'aria-label="SQL 编辑器"></textarea>' +
      "</div></div>";

    var result = document.createElement("section");
    result.className = "cv-result";
    result.innerHTML =
      '<div class="cv-rhead">' +
      '<span class="cv-rtitle">结果</span>' +
      '<span class="cv-rmeta" id="cv-meta"></span>' +
      '<span class="cv-spacer"></span>' +
      '<button class="cv-tbtn" type="button" id="cv-copy">复制</button>' +
      '<button class="cv-tbtn" type="button" id="cv-export">导出 CSV</button>' +
      '<span class="cv-rmeta" id="cv-elapsed"></span>' +
      "</div>" +
      '<div class="cv-rbody" id="cv-grid"></div>';

    var footer = document.createElement("div");
    footer.className = "cv-foot";
    footer.innerHTML =
      '<span id="cv-foot-left">prod-mysql · readonly</span>' +
      '<span class="cv-spacer"></span>' +
      '<span id="cv-foot-time"></span>' +
      '<span>utf8mb4</span>';

    var panel = document.createElement("aside");
    panel.className = "cv-panel";
    panel.hidden = true;
    panel.innerHTML =
      '<h4>设置</h4>' +
      '<div class="cv-row"><span>老板键</span><button class="cv-key" id="cv-key" type="button"></button></div>' +
      '<div class="cv-hint" id="cv-key-hint">点一下，然后按下组合键（Esc 取消）。</div>' +
      '<label class="cv-check"><input type="checkbox" id="cv-blur" /> 离开工作台时自动显示本界面</label>' +
      '<label class="cv-check"><input type="checkbox" id="cv-keep" /> 切回 DBX 时也保持伪装</label>' +
      '<label class="cv-check"><input type="checkbox" id="cv-start" /> 打开插件时先显示本界面</label>' +
      '<button class="cv-play" type="button" id="cv-play">进入游戏</button>';

    root.appendChild(status);
    root.appendChild(editor);
    root.appendChild(result);
    root.appendChild(footer);
    root.appendChild(panel);

    var sql = root.querySelector("#cv-sql");
    var hlEl = root.querySelector("#cv-hl");
    var gutterEl = root.querySelector("#cv-gutter");
    sql.value =
      "-- 今日订单概览（只读连接）\n" +
      "SELECT id, order_no, status, amount, updated_at\n" +
      "FROM orders\n" +
      "WHERE created_at >= '2026-11-02' AND status <> 'cancelled'\n" +
      "ORDER BY id DESC\n" +
      "LIMIT 500;";

    /* ── SQL 语法高亮 + 行号 ───────────────────────────────────────────
     * textarea 本身不能上色，所以叠一层 <pre>：textarea 文字透明、只留光标，
     * 高亮由下面的 pre 显示。两层字体/内距/行高必须完全一致，否则会错位。
     */
    var SQL_WORDS =
      "select from where order by group having limit offset and or not null is in as desc asc join left right inner outer on " +
      "update insert into delete values set create table distinct case when then else end like between exists union all cast coalesce";

    function escapeHtml(text) {
      return String(text).replace(/[&<>]/g, function (ch) {
        return ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;";
      });
    }

    function span(cls, text) {
      return '<span class="' + cls + '">' + escapeHtml(text) + "</span>";
    }

    function highlightSql(text) {
      var keywords = {};
      SQL_WORDS.split(" ").forEach(function (word) {
        keywords[word] = true;
      });
      var out = "";
      var index = 0;
      while (index < text.length) {
        var rest = text.slice(index);
        var match;
        if ((match = /^--[^\n]*/.exec(rest))) {
          out += span("c", match[0]);
          index += match[0].length;
          continue;
        }
        if ((match = /^'(?:[^']|'')*'?/.exec(rest))) {
          out += span("s", match[0]);
          index += match[0].length;
          continue;
        }
        if ((match = /^\d+(?:\.\d+)?/.exec(rest))) {
          out += span("n", match[0]);
          index += match[0].length;
          continue;
        }
        if ((match = /^[A-Za-z_][\w$]*/.exec(rest))) {
          var word = match[0];
          var cls = keywords[word.toLowerCase()] ? "k" : "";
          if (!cls && /^\s*\(/.test(rest.slice(word.length))) cls = "f";
          out += cls ? span(cls, word) : escapeHtml(word);
          index += word.length;
          continue;
        }
        out += escapeHtml(text[index]);
        index += 1;
      }
      return out;
    }

    function renderCode() {
      var text = sql.value;
      // 末尾补一行的占位，保证最后一个换行也能显示出来
      hlEl.innerHTML = highlightSql(text) + "\n";
      var lines = text.split("\n").length;
      var numbers = [];
      for (var n = 1; n <= lines; n += 1) numbers.push(n);
      gutterEl.textContent = numbers.join("\n");
      syncCodeScroll();
    }

    function syncCodeScroll() {
      hlEl.scrollTop = sql.scrollTop;
      hlEl.scrollLeft = sql.scrollLeft;
      gutterEl.scrollTop = sql.scrollTop;
    }

    sql.addEventListener("input", renderCode);
    sql.addEventListener("scroll", syncCodeScroll);
    sql.addEventListener("keydown", function (event) {
      // Tab 插入两个空格，而不是把焦点跳走
      if (event.key !== "Tab") return;
      event.preventDefault();
      var start = sql.selectionStart;
      var end = sql.selectionEnd;
      sql.value = sql.value.slice(0, start) + "  " + sql.value.slice(end);
      sql.selectionStart = sql.selectionEnd = start + 2;
      renderCode();
    });
    renderCode();

    var grid = root.querySelector("#cv-grid");
    var meta = root.querySelector("#cv-meta");
    var elapsed = root.querySelector("#cv-elapsed");
    var statusEl = root.querySelector("#cv-status");
    var searchEl = root.querySelector("#cv-search");

    var columns = ["id", "order_no", "status", "amount", "updated_at"];

    function renderRows(keyword) {
      var needle = String(keyword || "").trim().toLowerCase();
      var rows = COVER_ROWS.filter(function (row) {
        if (!needle) return true;
        return row.join(" ").toLowerCase().indexOf(needle) !== -1;
      });
      var head = columns
        .map(function (name) {
          return "<th>" + name + "</th>";
        })
        .join("");
      var body = rows
        .map(function (row) {
          return "<tr>" + row.map(function (cell) {
            return "<td>" + cell + "</td>";
          }).join("") + "</tr>";
        })
        .join("");
      grid.innerHTML = "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
      meta.textContent = rows.length + " 行";
      return rows;
    }

    var lastRows = renderRows("");
    elapsed.textContent = "4 ms";
    root.querySelector("#cv-foot-time").textContent = formatTime();

    root.querySelector("#cv-run").addEventListener("click", function () {
      statusEl.textContent = "执行中…";
      window.setTimeout(function () {
        lastRows = renderRows(searchEl.value);
        statusEl.textContent = "查询完成";
        elapsed.textContent = (3 + (lastRows.length % 5)) + " ms";
        root.querySelector("#cv-foot-time").textContent = formatTime();
      }, 220);
    });

    searchEl.addEventListener("input", function () {
      lastRows = renderRows(searchEl.value);
    });

    root.querySelector("#cv-copy").addEventListener("click", function () {
      var text = [columns.join("\t")]
        .concat(lastRows.map(function (row) {
          return row.join("\t");
        }))
        .join("\n");
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
        }
        statusEl.textContent = "已复制 " + lastRows.length + " 行";
      } catch (error) {
        statusEl.textContent = "复制失败";
      }
    });

    root.querySelector("#cv-export").addEventListener("click", function () {
      var text = [columns.join(",")]
        .concat(lastRows.map(function (row) {
          return row.map(function (cell) {
            return '"' + String(cell).replace(/"/g, '""') + '"';
          }).join(",");
        }))
        .join("\n");
      try {
        var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "orders-" + Date.now() + ".csv";
        link.click();
        statusEl.textContent = "已导出 CSV";
      } catch (error) {
        statusEl.textContent = "导出失败";
      }
    });

    // ── 老板键录制：点一下按钮，然后直接按组合键 ──────────────────────────
    var keyButton = panel.querySelector("#cv-key");
    var keyHint = panel.querySelector("#cv-key-hint");
    var keyDefaultHint = "点一下，然后按下组合键（Esc 取消）。";

    function renderKeyButton() {
      keyButtonRefresh = renderKeyButton;
      keyButton.textContent = recording ? "按下组合键…" : bossKeyCombo();
      keyButton.classList.toggle("cv-key--recording", recording);
      keyHint.textContent = recording ? "正在录制：按下组合键（Esc 取消）" : keyDefaultHint;
    }

    keyButton.addEventListener("click", function () {
      recording = !recording;
      renderKeyButton();
    });

    renderKeyButton();
    panel.querySelector("#cv-blur").checked = hideOnBlurEnabled();
    panel.querySelector("#cv-keep").checked = keepCoverOnFocusEnabled();
    panel.querySelector("#cv-start").checked = coverOnStartEnabled();

    panel.querySelector("#cv-blur").addEventListener("change", function (event) {
      writePref(COVER_BLUR_SETTING, event.target.checked ? "1" : "0");
    });
    panel.querySelector("#cv-keep").addEventListener("change", function (event) {
      writePref(COVER_KEEP_ON_FOCUS_SETTING, event.target.checked ? "1" : "0");
    });
    panel.querySelector("#cv-start").addEventListener("change", function (event) {
      writePref(COVER_ON_START_SETTING, event.target.checked ? "1" : "0");
    });
    panel.querySelector("#cv-play").addEventListener("click", function () {
      hideCover();
    });

    root.querySelector("#cv-gear").addEventListener("click", function (event) {
      event.stopPropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        recording = false;
        renderKeyButton();
        panel.querySelector("#cv-blur").checked = hideOnBlurEnabled();
        panel.querySelector("#cv-keep").checked = keepCoverOnFocusEnabled();
        panel.querySelector("#cv-start").checked = coverOnStartEnabled();
      }
    });
    // 点面板外面收起设置，别挡住"工作"的感觉
    root.addEventListener("mousedown", function (event) {
      if (panel.hidden) return;
      if (panel.contains(event.target) || event.target.id === "cv-gear") return;
      panel.hidden = true;
    });

    return root;
  }

  function suspendAudio(suspend) {
    audioContexts.forEach(function (context) {
      try {
        if (suspend) {
          if (context.state === "running" && context.suspend) context.suspend();
        } else if (context.state === "suspended" && context.resume) {
          context.resume();
        }
      } catch (error) {
        /* 忽略单个上下文失败 */
      }
    });
  }

  function showCover(byBlur) {
    if (coverActive) return;
    if (!coverEl) coverEl = buildCover();
    coverByBlur = byBlur === true;
    coverActive = true;
    // 伪装时标题不能露馅
    document.title = "DBX";
    document.body.appendChild(coverEl);
    suspendAudio(true);
    pauseRaf();
  }

  function hideCover() {
    if (!coverActive) return;
    coverActive = false;
    coverByBlur = false;
    recording = false;
    document.title = "AggressiveWar";
    if (coverEl && coverEl.parentNode) coverEl.parentNode.removeChild(coverEl);
    suspendAudio(false);
    resumeRaf();
  }

  // 打开插件先看到的就是这个界面（可在设置里关掉）
  function showCoverOnStart() {
    if (!coverOnStartEnabled()) {
      document.title = "AggressiveWar";
      return;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        showCover(false);
      });
    } else {
      showCover(false);
    }
  }

  showCoverOnStart();

  function toggleCover() {
    if (coverActive) hideCover();
    else showCover(false);
  }

  // 伪装层自己的输入框（SQL 编辑器、老板键）要能正常打字，不能一起被吞。
  function isCoverEditable(event) {
    var target = event && event.target;
    if (!target || !target.tagName) return false;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable === true
    );
  }

  // 捕获阶段拦热键：游戏在冒泡阶段监听键盘，这里先一步吃掉。
  window.addEventListener(
    "keydown",
    function (event) {
      // 录制中：这一下按键只用于设置热键，不切换伪装
      if (recording && coverActive) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") {
          recording = false;
          if (keyButtonRefresh) keyButtonRefresh();
          return;
        }
        var combo = comboFromEvent(event);
        if (combo) {
          writePref(COVER_KEY_SETTING, combo);
          recording = false;
          if (keyButtonRefresh) keyButtonRefresh();
        }
        return;
      }
      // 热键优先：即使正在输入框里也认（alt+x / ctrl+shift+z 不参与打字）
      if (matchesBossKey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleCover();
        return;
      }
      // 伪装期间把其它按键全部吞掉：否则在"数据库界面"上敲空格就结束回合了。
      if (coverActive && !isCoverEditable(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  ["keyup", "keypress"].forEach(function (name) {
    window.addEventListener(
      name,
      function (event) {
        if (coverActive && !isCoverEditable(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });

  // 失焦 → 伪装；回到前台 → 收起（只有因失焦显示的才自动收，热键的不动）。
  window.addEventListener("blur", function () {
    if (hideOnBlurEnabled()) showCover(true);
  });
  window.addEventListener("focus", function () {
    if (coverActive && coverByBlur && !keepCoverOnFocusEnabled()) hideCover();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && hideOnBlurEnabled()) showCover(true);
    else if (!document.hidden && coverActive && coverByBlur && !keepCoverOnFocusEnabled()) hideCover();
  });

  /* 兜底：有些宿主（切 DBX 标签、切窗口）不会给 iframe 派 blur，
   * 只靠事件会漏。这里轮询 document.hasFocus()，只要"曾经拿过焦点、现在丢了"
   * 就弹伪装。曾经拿过焦点这个前提很重要：否则刚打开还没点过就会一直弹。 */
  var sawFocus = document.hasFocus() && !document.hidden;
  window.setInterval(function () {
    if (!hideOnBlurEnabled()) return;
    var focused = document.hasFocus() && !document.hidden;
    if (focused) {
      sawFocus = true;
      if (coverActive && coverByBlur && !keepCoverOnFocusEnabled()) hideCover();
      return;
    }
    if (sawFocus && !coverActive) showCover(true);
  }, 400);


  /* ── 本地局域网联机：改造游戏原有的联机入口 + 中继控制面板 ─────────────
   *
   * 原游戏只有「手机当服务器 / 电脑 :3000 中继」两种，插件里都没有对应的服务。
   * 现在 sidecar 自带中继，所以把这一段改写成「本地局域网联机」，只保留
   * 直连（锁步）模式；房间的创建/加入仍然用游戏自己的按钮。
   */
  function reworkLanUi() {
    try {
      var trigger = document.getElementById("btn-lan-create");
      if (!trigger) return false;
      var block = trigger;
      while (block && block !== document.body) {
        if (block.classList && block.classList.contains("field")) break;
        block = block.parentElement;
      }
      if (!block || block === document.body) return false;

      var label = block.querySelector("label");
      if (label) label.textContent = "🌐 本地局域网联机（插件内置中继）";

      var select = block.querySelector("#sel-netmode");
      if (select) {
        Array.prototype.forEach.call(select.querySelectorAll("option"), function (option) {
          var keep = option.value === "lockstep";
          option.hidden = !keep;
          option.disabled = !keep;
          if (keep) {
            option.selected = true;
            option.textContent = "直连房间 · 插件内置中继（各端本地跑规则）";
          }
        });
      }

      var box = block.querySelector("#lan-box");
      if (box) {
        box.textContent = "先点右下角「联机」启动中继，再创建房间；手机连同一 WiFi 打开中继地址即可加入。";
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /* 中继控制面板：启动/停止 + 显示手机该访问的地址 */
  function buildRelayPanel() {
    if (!pluginApi()) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "🌐 联机";
    btn.style.cssText =
      "position:fixed;right:14px;bottom:14px;z-index:2147483000;padding:7px 12px;border-radius:999px;" +
      "border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;font:12px/1 system-ui,sans-serif;cursor:pointer;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.35)";

    var panel = document.createElement("div");
    panel.hidden = true;
    panel.style.cssText =
      "position:fixed;right:14px;bottom:56px;z-index:2147483001;width:310px;padding:12px;border-radius:10px;" +
      "border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;font:12px/1.6 system-ui,sans-serif;" +
      "box-shadow:0 12px 32px rgba(0,0,0,.45)";
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">本地局域网联机</div>' +
      '<div id="relay-status" style="color:#a1a1aa;margin-bottom:8px">中继未启动</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<button id="relay-start" style="flex:1;padding:6px;border-radius:6px;border:1px solid #2563eb;background:#1d4ed8;color:#fff;cursor:pointer">启动中继</button>' +
      '<button id="relay-stop" style="flex:1;padding:6px;border-radius:6px;border:1px solid #3f3f46;background:#27272a;color:#e4e4e7;cursor:pointer">停止</button>' +
      "</div>" +
      '<div id="relay-qr-box" style="display:none;text-align:center;margin:8px 0"></div>' +
      '<div id="relay-share" style="display:none;align-items:center;gap:6px;margin-bottom:6px">' +
      '<span id="relay-share-url" style="flex:1;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#93c5fd;word-break:break-all"></span>' +
      '<button id="relay-copy" style="padding:3px 8px;border-radius:5px;border:1px solid #3f3f46;background:#27272a;color:#e4e4e7;font-size:11px;cursor:pointer">复制</button>' +
      "</div>" +
      '<div id="relay-urls" style="font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;color:#71717a"></div>' +
      '<div style="margin-top:8px;color:#71717a;font-size:11px;line-height:1.6">手机连同一个 WiFi，扫上面的二维码（或打开地址）就能进游戏；在游戏菜单里创建/加入房间即可。<br>' +
      "手机连不上？多半是 Windows 防火墙拦了这个程序：到「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」里放行 DBX。" +
      "</div>";
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    var statusEl = panel.querySelector("#relay-status");
    var urlsEl = panel.querySelector("#relay-urls");

    function render(status) {
      if (!status) return;
      var qrBox = panel.querySelector("#relay-qr-box");
      var shareRow = panel.querySelector("#relay-share");
      var shareUrlEl = panel.querySelector("#relay-share-url");

      if (status.running) {
        var base = "中继运行中 · 端口 " + status.port + " · 房间 " + (status.rooms || 0);
        // 二维码：手机扫一下直接打开，不用手输 IP
        if (status.qrSvg && qrBox) {
          qrBox.style.display = "block";
          qrBox.innerHTML =
            '<div style="display:inline-block;padding:8px;border-radius:8px;background:#fff">' + status.qrSvg + "</div>";
          var svg = qrBox.querySelector("svg");
          if (svg) {
            svg.style.display = "block";
            svg.style.width = "150px";
            svg.style.height = "150px";
          }
        }
        if (status.shareUrl && shareRow && shareUrlEl) {
          shareRow.style.display = "flex";
          shareUrlEl.textContent = status.shareUrl;
        }
        if (status.reachable === false) {
          statusEl.textContent = base + "（本机连不上）";
          statusEl.style.color = "#fbbf24";
          urlsEl.innerHTML =
            (status.urls || []).join("<br>") +
            '<div style="margin-top:8px;color:#fbbf24;font-family:system-ui,sans-serif;line-height:1.6">' +
            "Windows 防火墙拦住了这个程序：端口已经在监听，但其它设备（甚至本机）都连不上。<br>" +
            "请到「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」，勾选 DBX（或该插件进程），然后点下面重新自检。" +
            "</div>" +
            '<button id="relay-retry" style="margin-top:8px;padding:5px 10px;border-radius:6px;border:1px solid #3f3f46;background:#27272a;color:#e4e4e7;cursor:pointer">重新自检</button>';
          var retry = urlsEl.querySelector("#relay-retry");
          if (retry) {
            retry.addEventListener("click", function () {
              invoke("lan/stop")
                .then(function () {
                  return invoke("lan/start", { port: 3000 });
                })
                .then(function (result) {
                  if (result) refreshStatus();
                });
            });
          }
        } else {
          statusEl.textContent = base;
          statusEl.style.color = "#86efac";
          urlsEl.innerHTML = (status.urls || []).join("<br>");
        }
      } else {
        statusEl.textContent = "中继未启动";
        statusEl.style.color = "#a1a1aa";
        urlsEl.textContent = "";
        if (qrBox) {
          qrBox.style.display = "none";
          qrBox.innerHTML = "";
        }
        if (shareRow) shareRow.style.display = "none";
      }
    }

    /** 状态查询统一走 /status（它带二维码与可达性，start 的返回只有一部分字段）。 */
    function refreshStatus() {
      return invoke("lan/status").then(function (result) {
        if (result) render(result);
        return result;
      });
    }

    function invoke(method, params) {
      return pluginApi().invoke(method, params || {}).catch(function (error) {
        statusEl.textContent = "失败：" + String((error && error.message) || error);
        statusEl.style.color = "#fca5a5";
        return null;
      });
    }

    panel.querySelector("#relay-copy").addEventListener("click", function () {
      var text = shareUrlEl ? shareUrlEl.textContent : "";
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        panel.querySelector("#relay-copy").textContent = "已复制";
        window.setTimeout(function () {
          panel.querySelector("#relay-copy").textContent = "复制";
        }, 1500);
      } catch (error) {
        /* 剪贴板不可用就保持原样 */
      }
    });

    panel.querySelector("#relay-start").addEventListener("click", function () {
      statusEl.textContent = "正在启动…";
      invoke("lan/start", { port: 3000 }).then(function () {
        refreshStatus();
      });
    });
    panel.querySelector("#relay-stop").addEventListener("click", function () {
      invoke("lan/stop").then(function () {
        render({ running: false });
      });
    });
    btn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refreshStatus();
    });

    // 启动时同步一次状态（面板关着也要知道按钮该不该高亮）
    refreshStatus();
  }

  function applyPluginUi() {
    reworkLanUi();
    buildRelayPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyPluginUi);
  } else {
    applyPluginUi();
  }

  // 供本地调试 / 自动化测试观察与控制
  window.__gongfaPlugin = {
    storage: !!storage,
    localStorageInstalled: installed,
    ready: ready,
    flush: flush,
    snapshot: function () {
      return Object.assign({}, data);
    },
    cover: {
      isActive: function () {
        return coverActive;
      },
      show: showCover,
      hide: hideCover,
      toggle: toggleCover,
      key: bossKeyCombo,
      setKey: function (combo) {
        writePref(COVER_KEY_SETTING, String(combo || DEFAULT_BOSS_KEY));
      },
      hideOnBlur: hideOnBlurEnabled,
      lan: function () {
        return { sandbox: isPluginSandbox(), sockets: Object.keys(relaySockets).length };
      },
      setHideOnBlur: function (on) {
        writePref(COVER_BLUR_SETTING, on ? "1" : "0");
      }
    }
  };
})();
