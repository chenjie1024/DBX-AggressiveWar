// 把构建好的 ui/ 嵌进 sidecar：局域网里由 sidecar 直接托管游戏页面。
//
// 为什么不用"运行时读 ui 目录"：插件安装后的路径不稳定（bin/ 与 ui/ 的相对位置
// 依赖宿主布局），而 UI 一共才 160 KB，直接 include_bytes! 最省心——
// 代价是改了 UI 要重新构建 sidecar，build-ui.mjs 会自动做这一步。
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = join(pluginRoot, "ui");
const outFile = join(pluginRoot, "backend", "src", "assets.rs");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) out.push(...walk(full, `${prefix}/${name}`));
    else out.push({ url: `${prefix}/${name}`, path: full });
  }
  return out;
}

const files = walk(uiDir).sort((a, b) => a.url.localeCompare(b.url));
const entries = files
  .map((file) => {
    // include_bytes! 的路径相对 src/assets.rs
    const relative = `../../ui${file.url}`.replace(/\\/g, "/");
    return `    ("${file.url}", include_bytes!("${relative}") as &[u8]),`;
  })
  .join("\n");

const types = Object.entries(TYPES)
  .map(([ext, type]) => `        "${ext}" => "${type}",`)
  .join("\n");

const source = `// 由 tools/gen-assets.mjs 生成，请勿手改。
pub static ASSETS: &[(&str, &[u8])] = &[
${entries}
];

pub fn lookup(path: &str) -> Option<&'static [u8]> {
    ASSETS
        .iter()
        .find(|(name, _)| *name == path)
        .map(|(_, bytes)| *bytes)
}

pub fn content_type(path: &str) -> &'static str {
    // 注意：这里取到的 ext 不含点（"html"），所以先补一个点再匹配。
    // 之前漏了这一步，所有文件都落进 octet-stream，浏览器打开就变成下载。
    let ext = path.rsplit('.').next().unwrap_or("");
    let dotted = format!(".{ext}");
    match dotted.as_str() {
${types}
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types_match_dotted_table() {
        assert_eq!(content_type("/index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type("/plugin-shim.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("/assets/index-abc.css"), "text/css; charset=utf-8");
        assert_eq!(content_type("/assets/icon.svg"), "image/svg+xml");
        assert_eq!(content_type("/a/unknown.bin"), "application/octet-stream");
    }
}
`;

writeFileSync(outFile, source, "utf8");
const total = files.reduce((sum, file) => sum + statSync(file.path).size, 0);
console.log(`嵌入 ${files.length} 个资源（${(total / 1024).toFixed(0)} KB）→ backend/src/assets.rs`);
