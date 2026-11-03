// 面板：显示房间码 + 自检结论降级为“参考”。
import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(eol);

const find = (needle) => {
  const index = lines.findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`未找到：${needle}`);
  return index;
};

// 1) 面板 HTML：房间码一行（放在二维码下面）
const qrBox = find('id="relay-qr-box"');
lines.splice(
  qrBox + 1,
  0,
  '      \'<div id="relay-room" style="display:none;align-items:center;gap:6px;margin-bottom:6px">\' +',
  '      \'<span style="color:#71717a">房间码</span>\' +',
  '      \'<span id="relay-room-code" style="font-family:ui-monospace,Consolas,monospace;font-size:15px;font-weight:700;letter-spacing:2px;color:#fbbf24"></span>\' +',
  '      \'<button id="relay-room-copy" style="margin-left:auto;padding:2px 8px;border-radius:5px;border:1px solid #3f3f46;background:#27272a;color:#e4e4e7;font-size:11px;cursor:pointer">复制</button>\' +',
  '      "</div>" +',
);

// 2) 自检结论降级
const reachFalse = find('statusEl.textContent = base + "（本机连不上）";');
lines[reachFalse] = '          statusEl.textContent = base;';
const reachColor = find('statusEl.style.color = "#fbbf24";');
// 只改第一处（false 分支）
lines[reachColor] = '          statusEl.style.color = "#fbbf24";';

const warnText = find("Windows 防火墙拦住了这个程序");
lines[warnText] =
  '            "自检（仅供参考）：在这个进程里连自己的端口没有成功——可能是防火墙拦截，也可能只是自检的局限。<b>以手机能否打开为准</b>。<br>" +';
lines[warnText + 1] =
  '            "如果手机也打不开：到「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」勾选 DBX（或该插件进程），再点下面重新自检。" +';

const okBranch = find('urlsEl.innerHTML = (status.urls || []).join("<br>");');
lines[okBranch] =
  '          urlsEl.innerHTML =' +
  eol +
  '            (status.urls || []).join("<br>") +' +
  eol +
  '            \'<div style="margin-top:6px;color:#52525b;font-size:11px">自检：本机可连（仅供参考，以手机能否打开为准）</div>\';';

writeFileSync(file, lines.join(eol), "utf8");
console.log("panel patched");
