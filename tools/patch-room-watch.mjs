// 面板：从游戏菜单的 #lan-box 抓房间码并显示在面板上。
import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(eol);

const anchor = lines.findIndex((line) => line.includes('var urlsEl = panel.querySelector("#relay-urls");'));
if (anchor < 0) throw new Error("urlsEl anchor missing");

const block = [
  "",
  "    // 房间码：游戏菜单里创建房间后，把码同步到面板上，房主不用来回切界面",
  '    var roomRow = panel.querySelector("#relay-room");',
  '    var roomCodeEl = panel.querySelector("#relay-room-code");',
  "    var lastRoomCode = null;",
  "    function refreshRoomCode() {",
  '      var box = document.getElementById("lan-box");',
  "      var code = null;",
  "      if (box) {",
  '        var matched = (box.textContent || "").match(/房间码\\s*([A-Z0-9]{4})/);',
  "        if (matched) code = matched[1];",
  "      }",
  "      if (code === lastRoomCode) return;",
  "      lastRoomCode = code;",
  "      if (!roomRow) return;",
  "      if (code) {",
  '        roomRow.style.display = "flex";',
  "        roomCodeEl.textContent = code;",
  "      } else {",
  '        roomRow.style.display = "none";',
  '        roomCodeEl.textContent = "";',
  "      }",
  "    }",
  "    window.setInterval(refreshRoomCode, 800);",
  "    refreshRoomCode();",
  '    var roomCopy = panel.querySelector("#relay-room-copy");',
  "    if (roomCopy) {",
  '      roomCopy.addEventListener("click", function () {',
  '        var text = roomCodeEl ? roomCodeEl.textContent : "";',
  "        if (!text) return;",
  "        try {",
  "          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);",
  '          roomCopy.textContent = "已复制";',
  "          window.setTimeout(function () {",
  '            roomCopy.textContent = "复制";',
  "          }, 1500);",
  "        } catch (error) {",
  "          /* 剪贴板不可用时忽略 */",
  "        }",
  "      });",
  "    }",
];

lines.splice(anchor + 1, 0, ...block);
writeFileSync(file, lines.join(eol), "utf8");
console.log("room code watcher added");
