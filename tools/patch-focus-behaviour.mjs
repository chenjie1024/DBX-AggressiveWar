// 失焦/回焦行为重做：
//   旧：blur 弹伪装，任何 focus 都收起 → 回标签或点一下就露出游戏，还会闪一下。
//   新：blur 弹伪装后**一直保持**，只有老板键 / 「进入游戏」才解开；
//       另给一个默认关闭的开关「点回工作台时自动露出游戏」。
import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let lines = raw.split(eol);

const find = (needle, from = 0) => {
  const index = lines.findIndex((line, i) => i >= from && line.includes(needle));
  if (index < 0) throw new Error(`未找到：${needle}`);
  return index;
};

// 1) 设置项换成 autoRestoreOnFocus（默认关）
const keepSetting = find("COVER_KEEP_ON_FOCUS_SETTING");
lines[keepSetting] =
  '  var COVER_AUTO_RESTORE_SETTING = "gongfa-war.autoRestoreOnFocus";';

const keepFn = find("function keepCoverOnFocusEnabled()");
lines[keepFn] =
  "  /** 点回工作台时是否自动露出游戏（默认不：伪装要靠老板键或「进入游戏」解开）。 */";
lines[keepFn + 1] = "  function autoRestoreOnFocusEnabled() {";
lines[keepFn + 2] =
  '    return readPref(COVER_AUTO_RESTORE_SETTING, "0") === "1";';
lines[keepFn + 3] = "  }";

// 2) focus / visibilitychange / 轮询里的条件一起换
for (let i = 0; i < lines.length; i += 1) {
  lines[i] = lines[i]
    .replace(/keepCoverOnFocusEnabled\(\)/g, "autoRestoreOnFocusEnabled()")
    .replace(/"gongfa-war\.keepCoverOnFocus"/g, '"gongfa-war.autoRestoreOnFocus"');
}

// 3) 设置面板文案（勾选项语义反过来：勾上才自动露出游戏）
const keepCheckbox = find('id="cv-keep"');
lines[keepCheckbox] = lines[keepCheckbox].replace(
  "切回 DBX 时也保持伪装",
  "点回工作台时自动露出游戏",
);

writeFileSync(file, lines.join(eol), "utf8");
console.log("focus behaviour rewritten");
