// 一次性脚本：把对端可控的字符串（玩家昵称 / 远端排行榜名）在插入 innerHTML 前统一转义。
//
// 三条路径（来自维护者 review）：
//   - ui/hud.ts: 势力详情里的 p.name
//   - main.ts:  联机房间成员列表里的 p.name
//   - ui/menu.ts: 远端排行榜的 displayName
// 虽然中继把名字限到 12 字符、插件侧也挡住了 /api/*，但这是"目前不可达"而不是"不可能"。
import { readFileSync, writeFileSync } from "node:fs";

const root = "D:/projiect/aggressiveWar/packages/web/src";

// 1) 新建共享的转义工具
const util = `/**
 * 把任意字符串转成可安全放进 innerHTML 的文本。
 *
 * 用途：任何来自对端（联机昵称、远端排行榜、URL 参数）的字符串，插入 HTML 前都要过一遍。
 * 我们宁可多转义几个字符，也不想因为一个昵称丢掉整个 XSS 面。
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
`;
writeFileSync(`${root}/escape.ts`, util, "utf8");

function patch(file, replacers) {
  const path = `${root}/${file}`;
  let text = readFileSync(path, "utf8");
  for (const [from, to] of replacers) {
    if (!text.includes(from)) throw new Error(`未匹配：${file} -> ${from.slice(0, 60)}`);
    text = text.split(from).join(to);
  }
  writeFileSync(path, text, "utf8");
  console.log(`patched ${file}`);
}

// 2) hud.ts：昵称转义（同一行里还有 nationEmoji，只转 name）
patch("ui/hud.ts", [
  [
    "${nationEmoji(p.nationId)} ${p.name}${p.isHuman ? '（我）' : ''}",
    "${nationEmoji(p.nationId)} ${escapeHtml(p.name)}${p.isHuman ? '（我）' : ''}",
  ],
]);

// 3) main.ts：联机房间成员昵称
patch("main.ts", [
  [
    "`<div>${p.seat === 0 ? '👑 ' : ''}🧑 ${p.name}${p.seat === mySeat ? '（我）' : ''}${p.connected ? '' : ' · 掉线'}</div>`",
    "`<div>${p.seat === 0 ? '👑 ' : ''}🧑 ${escapeHtml(p.name)}${p.seat === mySeat ? '（我）' : ''}${p.connected ? '' : ' · 掉线'}</div>`",
  ],
]);

// 4) menu.ts：远端排行榜昵称
patch("ui/menu.ts", [
  [
    "<td>${e.displayName ?? '匿名'}</td>",
    "<td>${escapeHtml(e.displayName ?? '匿名')}</td>",
  ],
]);

// 5) 补 import（按文件现有 import 风格插入）
function addImport(file, line) {
  const path = `${root}/${file}`;
  let text = readFileSync(path, "utf8");
  if (text.includes(line)) return;
  const lines = text.split("\n");
  const lastImport = lines.reduce((acc, l, i) => (l.startsWith("import ") ? i : acc), -1);
  if (lastImport < 0) throw new Error(`找不到 import 区：${file}`);
  lines.splice(lastImport + 1, 0, line);
  writeFileSync(path, lines.join("\n"), "utf8");
  console.log(`import added to ${file}`);
}

addImport("ui/hud.ts", "import { escapeHtml } from '../escape';");
addImport("main.ts", "import { escapeHtml } from './escape';");
addImport("ui/menu.ts", "import { escapeHtml } from '../escape';");
