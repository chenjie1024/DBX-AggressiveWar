// 构建插件 UI：从攻伐战争仓库构建 Web 产物到本插件 ui/，再注入适配层。
//
// 用法：
//   node tools/build-ui.mjs
//   GONGFA_REPO=D:\somewhere\aggressiveWar node tools/build-ui.mjs
//
// 为什么要拷贝产物而不是直接引用源码：插件包只认 ui/ 下的静态文件，
// 游戏仓库保持原样、可以继续独立开发。
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = process.env.GONGFA_REPO || resolve(pluginRoot, "..", "..", "aggressiveWar");
const uiDir = join(pluginRoot, "ui");
const shimSource = join(pluginRoot, "ui-src", "plugin-shim.js");

if (!existsSync(join(repo, "package.json"))) {
  console.error(`找不到攻伐战争仓库：${repo}\n可以用 GONGFA_REPO=<路径> 指定。`);
  process.exit(1);
}

console.log(`游戏仓库: ${repo}`);
console.log(`输出目录: ${uiDir}`);

// 1) 构建（Vite，相对路径 base 已在游戏仓库里配好）
execSync(`npm --workspace @gongfa-war/web run build -- --outDir "${uiDir}" --emptyOutDir`, {
  cwd: repo,
  stdio: "inherit",
});

// 2) 清理用不上的 PWA 产物（沙箱里没有 service worker / 安装入口）
for (const name of ["sw.js", "manifest.webmanifest"]) {
  const target = join(uiDir, name);
  if (existsSync(target)) rmSync(target);
}

// 3) 注入适配层：必须在主脚本之前执行
copyFileSync(shimSource, join(uiDir, "plugin-shim.js"));
// 标签页图标：和插件图标保持一致（原来是游戏自带的 ⚔️ emoji）
copyFileSync(join(pluginRoot, "assets", "icon.svg"), join(uiDir, "icon.svg"));
const indexPath = join(uiDir, "index.html");
let html = readFileSync(indexPath, "utf8");
html = html.replace(/\s*<link rel="manifest"[^>]*>/g, "");
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, "");
// 标签页标题改成插件名（伪装层显示时会临时换成 DBX）
html = html.replace(/<title>[^<]*<\/title>/, "<title>AggressiveWar</title>");
html = html.replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, "$1AggressiveWar$2");
html = html.replace(/(<meta name="description" content=")[^"]*(")/, "$1AggressiveWar$2");
// favicon：换成插件图标。游戏模板里是一个带 emoji 的 data URL（内含 ">"），
// 正则截不干净，所以按行删掉所有 rel="icon" 的行，再插一条新的。
html = html
  .split(/\r?\n/)
  .filter((line) => !line.includes('rel="icon"'))
  .join("\n");
html = html.replace("</head>", '  <link rel="icon" type="image/svg+xml" href="./icon.svg" />\n  </head>');
if (!html.includes("plugin-shim.js")) {
  // 放在 </head> 前：比 <script type="module"> 早执行（module 默认 defer）
  html = html.replace(/(<script type="module")/, '    <script src="./plugin-shim.js"></script>\n  $1');
}
writeFileSync(indexPath, html, "utf8");

// 4) 汇报体积
let total = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full);
    else total += info.size;
  }
}
walk(uiDir);
console.log(`UI 构建完成：${(total / 1024).toFixed(0)} KB`);

// 5) 把 UI 嵌进 sidecar（局域网托管要用），改完 UI 记得重新编译后端
execSync(`node "${join(pluginRoot, "tools", "gen-assets.mjs")}"`, { stdio: "inherit" });
console.log(`适配层已注入: ${html.includes("plugin-shim.js")}`);
