import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(eol);

const anchor = lines.findIndex((l) => l.includes("function syncCodeScroll() {"));
if (anchor < 0) throw new Error("syncCodeScroll not found");

// 在 syncCodeScroll 之前插入"把 textarea 的排版参数抄给高亮层"，防止未来 CSS 漂移。
const block = [
  "    /** 把输入层的排版参数抄给高亮层：字体、内距、制表位只要有一点不一致，",
  "     * 光标就会画在字的旁边而不是字后面。这里在运行时对齐一次，CSS 改了也不会错位。 */",
  "    function syncEditorMetrics() {",
  "      var cs = getComputedStyle(sql);",
  "      hlEl.style.font = cs.font;",
  "      hlEl.style.letterSpacing = cs.letterSpacing;",
  "      hlEl.style.lineHeight = cs.lineHeight;",
  "      hlEl.style.paddingTop = cs.paddingTop;",
  "      hlEl.style.paddingRight = cs.paddingRight;",
  "      hlEl.style.paddingBottom = cs.paddingBottom;",
  "      hlEl.style.paddingLeft = cs.paddingLeft;",
  "      hlEl.style.tabSize = cs.tabSize;",
  "      gutterEl.style.font = cs.font;",
  "      gutterEl.style.lineHeight = cs.lineHeight;",
  "      gutterEl.style.paddingTop = cs.paddingTop;",
  "      gutterEl.style.paddingBottom = cs.paddingBottom;",
  "    }",
  "",
];
lines.splice(anchor, 0, ...block);

// 初始化时同步一次，并在窗口尺寸变化时重同步（软换行点位会随宽度变）
const initAnchor = lines.findIndex((l) => l.includes('sql.addEventListener("input", renderCode);'));
if (initAnchor < 0) throw new Error("init anchor not found");
lines.splice(initAnchor, 0, "    syncEditorMetrics();");
const scrollHookIndex = lines.findIndex((l) => l.includes('sql.addEventListener("scroll", syncCodeScroll);'));
if (scrollHookIndex < 0) throw new Error("scroll hook not found");
lines.splice(
  scrollHookIndex + 1,
  0,
  "    window.addEventListener(\"resize\", function () {",
  "      syncEditorMetrics();",
  "      renderCode();",
  "    });",
);

writeFileSync(file, lines.join(eol), "utf8");
console.log("editor metrics sync added");
