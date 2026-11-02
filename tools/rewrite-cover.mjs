// 一次性脚本：把适配层里的伪装层实现替换成「SQL 编辑器 + 结果表格 + 右上角设置」的版本。
import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const source = readFileSync(file, "utf8");

const startMarker = "  function buildCover() {";
const endMarker = "  function toggleCover() {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end < start) {
  throw new Error("找不到替换区间");
}

const replacement = `  var COVER_STYLE_ID = "dbx-cover-style";
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
    "#dbx-cover .cv-sql{flex:1;width:100%;box-sizing:border-box;resize:none;border:none;outline:none;background:#12141a;color:#cfd3da;",
    "padding:10px 14px;font:12.5px/1.7 ui-monospace,Consolas,'Cascadia Mono',monospace;tab-size:2}",
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
      '<textarea class="cv-sql" id="cv-sql" spellcheck="false" ' +
      'aria-label="SQL 编辑器"></textarea>';

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
      '<div class="cv-row"><span>老板键</span><input class="cv-key" id="cv-key" spellcheck="false" /></div>' +
      '<div class="cv-hint">格式如 ctrl+shift+z、alt+x；改完立即生效。</div>' +
      '<label class="cv-check"><input type="checkbox" id="cv-blur" /> 离开工作台时自动显示本界面</label>' +
      '<label class="cv-check"><input type="checkbox" id="cv-start" /> 打开插件时先显示本界面</label>' +
      '<button class="cv-play" type="button" id="cv-play">进入游戏</button>';

    root.appendChild(status);
    root.appendChild(editor);
    root.appendChild(result);
    root.appendChild(footer);
    root.appendChild(panel);

    var sql = root.querySelector("#cv-sql");
    sql.value =
      "-- 今日订单概览（只读连接）\\n" +
      "SELECT id, order_no, status, amount, updated_at\\n" +
      "FROM orders\\n" +
      "WHERE created_at >= '2026-11-02' AND status <> 'cancelled'\\n" +
      "ORDER BY id DESC\\n" +
      "LIMIT 500;";

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
      var text = [columns.join("\\t")]
        .concat(lastRows.map(function (row) {
          return row.join("\\t");
        }))
        .join("\\n");
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
        .join("\\n");
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

    panel.querySelector("#cv-key").value = bossKeyCombo();
    panel.querySelector("#cv-blur").checked = hideOnBlurEnabled();
    panel.querySelector("#cv-start").checked = coverOnStartEnabled();

    panel.querySelector("#cv-key").addEventListener("change", function (event) {
      var value = String(event.target.value || "").trim().toLowerCase();
      if (!/^([a-z0-9]+\\+)*[a-z0-9]$/.test(value)) {
        event.target.value = bossKeyCombo();
        return;
      }
      writePref(COVER_KEY_SETTING, value);
      event.target.value = value;
    });
    panel.querySelector("#cv-blur").addEventListener("change", function (event) {
      writePref(COVER_BLUR_SETTING, event.target.checked ? "1" : "0");
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
        panel.querySelector("#cv-key").value = bossKeyCombo();
        panel.querySelector("#cv-blur").checked = hideOnBlurEnabled();
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
  }

  function hideCover() {
    if (!coverActive) return;
    coverActive = false;
    coverByBlur = false;
    document.title = "AggressiveWar";
    if (coverEl && coverEl.parentNode) coverEl.parentNode.removeChild(coverEl);
    suspendAudio(false);
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

`;

writeFileSync(file, source.slice(0, start) + replacement + source.slice(end), "utf8");
console.log("替换完成");
