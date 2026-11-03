// 一次性脚本：重写 manifest 的描述字段（之前用正则全局替换，误伤了 en 本地化与贡献描述）。
import { readFileSync, writeFileSync } from "node:fs";

const path = "D:/projiect/dbx/gongfawar/manifest.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));

const ZH =
  "在 DBX 里征服了 SQL，为什么不来这里征服世界？27 个国家、随机地图、AI 对手，打开即见。局域网开房时会在本机监听端口（仅在你点「启动中继」后）。";
const EN =
  "You've conquered SQL in DBX — why not conquer the world here? 27 nations, procedural maps, AI rivals. Opening a LAN room listens on a local port (only after you press \"Start relay\").";

const ZH_SHORT = "区域征服 · 回合制 · 数字兵力。";
const EN_SHORT = "Region conquest, turn-based, numeric troops.";
const ZH_OPEN = "在新的标签页打开 AggressiveWar。";
const EN_OPEN = "Open AggressiveWar in a new tab.";

manifest.description = ZH;

const byId = Object.fromEntries(manifest.contributions.map((c) => [c.id, c]));
byId["com.xingxi.game.play"].description = ZH_SHORT;
byId["com.xingxi.game.open"].description = ZH_OPEN;

manifest.localizations["zh-CN"].name = "AggressiveWar";
manifest.localizations["zh-CN"].description = ZH;
manifest.localizations["zh-CN"].contributions = {
  "com.xingxi.game.play": { label: "AggressiveWar", description: ZH_SHORT },
  "com.xingxi.game.open": { label: "AggressiveWar", description: ZH_OPEN },
};

manifest.localizations.en.name = "AggressiveWar";
manifest.localizations.en.description = EN;
manifest.localizations.en.contributions = {
  "com.xingxi.game.play": { label: "AggressiveWar", description: EN_SHORT },
  "com.xingxi.game.open": { label: "AggressiveWar", description: EN_OPEN },
};

manifest.version = "0.5.2";
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("version:", manifest.version);
console.log("zh:", manifest.description);
console.log("en:", manifest.localizations.en.description);
console.log("play desc:", byId["com.xingxi.game.play"].description);
