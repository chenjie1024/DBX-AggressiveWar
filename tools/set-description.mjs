// 一次性脚本：把插件介绍改成选定的 A 版文案（zh + en），并生成商店元数据。
import { readFileSync, writeFileSync } from "node:fs";

const dir = "D:/projiect/dbx/gongfawar";

const ZH = "在 DBX 里征服了 SQL，为什么不来这里征服世界？27 个国家、随机地图、AI 对手，打开即见。";
const EN = "You've conquered SQL in DBX — why not conquer the world here? 27 nations, procedural maps, AI rivals.";

// 1) manifest.json：description + 两个语言的本地化描述
const manifestPath = `${dir}/manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.description = ZH;
manifest.localizations["zh-CN"].description = ZH;
manifest.localizations.en.description = EN;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

// 2) 商店元数据：dbx-store 用它生成目录条目
const store = {
  description: ZH,
  descriptionEn: EN,
  license: "MIT",
  categories: ["games", "productivity"],
  keywords: ["回合制", "策略", "征服", "单机", "局域网联机", "伪装"],
  screenshots: [],
  permissions: ["host.storage"],
};
writeFileSync(`${dir}/.dbx-store.json`, `${JSON.stringify(store, null, 2)}\n`, "utf8");

console.log("manifest description:", manifest.description);
console.log("store description:", store.description);
