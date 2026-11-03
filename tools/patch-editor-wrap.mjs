// 一次性脚本：把伪装层的 SQL 编辑器改成软换行，修光标错位。
// 注意：文件是 CRLF，按行处理比多行字符串匹配稳。
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

// 高亮层：软换行
const hl = find('"#dbx-cover .cv-hl{position:absolute');
lines[hl] =
  '    "#dbx-cover .cv-hl{position:absolute;inset:0;margin:0;padding:10px 14px;overflow:hidden;",';
lines[hl + 1] =
  '    "white-space:pre-wrap;word-break:break-word;font:12.5px/1.7 ui-monospace,Consolas,\'Cascadia Mono\',monospace;",' +
  eol +
  '    "color:#cfd3da;pointer-events:none;tab-size:2}",';

// 输入层：软换行 + 隐藏滚动条（保证与高亮层同宽）
const sql = find('"#dbx-cover .cv-sql{position:absolute');
lines[sql] =
  '    // 软换行：高亮层与输入层用同一套换行规则，并隐藏 textarea 滚动条，让两边内容宽度完全一致。';
lines[sql + 1] =
  '    "#dbx-cover .cv-sql{position:absolute;inset:0;width:100%;height:100%;flex:none;box-sizing:border-box;resize:none;border:none;",';
lines[sql + 2] =
  '    "outline:none;background:transparent;color:transparent;caret-color:#f8fafc;margin:0;",';
lines[sql + 3] =
  '    "white-space:pre-wrap;word-break:break-word;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;",';
lines[sql + 4] =
  '    "padding:10px 14px;font:12.5px/1.7 ui-monospace,Consolas,\'Cascadia Mono\',monospace;tab-size:2}",' +
  eol +
  '    "#dbx-cover .cv-sql::-webkit-scrollbar{width:0;height:0}",';

// 同步滚动只保留纵向
const syncStart = find("function syncCodeScroll() {");
for (let i = syncStart; i < syncStart + 8; i += 1) {
  if (lines[i].includes("hlEl.scrollLeft = sql.scrollLeft;")) {
    lines[i] = "      // 软换行后不会横向滚动，只同步纵向即可";
    break;
  }
}

writeFileSync(file, lines.join(eol), "utf8");
console.log("patched editor wrap");
