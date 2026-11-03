// 只保留老板键作为"进入游戏"的唯一入口：
//   - 删掉设置里的「进入游戏」按钮
//   - 删掉「点回工作台时自动露出游戏」选项与对应逻辑
//   - 设置里写清楚：老板键 = 伪装 / 游戏 的开关
import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(eol);
const out = [];

const drop = (predicate, label) => {
  let removed = 0;
  for (const line of lines) {
    if (predicate(line)) {
      removed += 1;
      continue;
    }
    out.push(line);
  }
  if (!removed) throw new Error(`没有删到：${label}`);
  console.log(`${label}: -${removed}`);
};

// 1) 删「进入游戏」按钮相关的 CSS / 标记 / 事件
drop((l) => l.includes("cv-play{") || l.includes("cv-play:hover"), "css .cv-play");
drop((l) => l.includes('id="cv-play"'), "markup #cv-play");
drop(
  (l) =>
    l.includes('panel.querySelector("#cv-play")') ||
    l.trim() === "hideCover();" && false,
  "handler #cv-play (open)",
);

// handler 是 3 行块：panel...addEventListener(... { hideCover(); });
const handlerStart = out.findIndex((l) => l.includes('panel.querySelector("#cv-play")'));
if (handlerStart >= 0) {
  out.splice(handlerStart, 3);
  console.log("handler #cv-play (block): -3");
}

// 2) 删「自动露出游戏」选项
const keepIdx = out.findIndex((l) => l.includes('id="cv-keep"'));
if (keepIdx < 0) throw new Error("没有找到 cv-keep 标记");
out.splice(keepIdx, 1);
console.log("markup #cv-keep: -1");

for (let i = out.length - 1; i >= 0; i -= 1) {
  const line = out[i];
  if (
    line.includes('panel.querySelector("#cv-keep")') ||
    line.includes("COVER_KEEP_ON_FOCUS_SETTING") ||
    (line.includes('id="cv-keep"') && line.includes("addEventListener")) ||
    line.includes("autoRestoreOnFocusEnabled()") ||
    line.includes("COVER_AUTO_RESTORE_SETTING") ||
    line.includes('"gongfa-war.autoRestoreOnFocus"')
  ) {
    out.splice(i, 1);
  }
}

// 3) 回焦/可见性不再收起伪装（整个分支删掉）
const focusIdx = out.findIndex((l) => l.includes('window.addEventListener("focus"'));
if (focusIdx >= 0) {
  // 3 行：( ... focus, function () {, if(...) hideCover(); }); 可能跨 4 行
  let end = focusIdx;
  while (end < out.length && !out[end].includes("});")) end += 1;
  out.splice(focusIdx, end - focusIdx + 1);
  console.log("focus handler removed");
}

// visibilitychange：只保留"隐藏时弹伪装"，去掉"恢复时收起"
const visIdx = out.findIndex((l, i) => i > 900 && l.includes('document.addEventListener("visibilitychange"'));
if (visIdx >= 0) {
  let end = visIdx;
  while (end < out.length && !out[end].includes("});")) end += 1;
  const replacement = [
    '  document.addEventListener("visibilitychange", function () {',
    "    // 只负责弹：露不露出游戏只由老板键决定",
    "    if (document.hidden && hideOnBlurEnabled()) showCover(true);",
    "  });",
  ];
  out.splice(visIdx, end - visIdx + 1, ...replacement);
  console.log("visibilitychange trimmed");
}

writeFileSync(file, out.join(eol), "utf8");
