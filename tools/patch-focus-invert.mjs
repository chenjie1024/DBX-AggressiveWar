import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.split(eol).join("\n");

// 语义反转：只有显式开启 autoRestoreOnFocus 才在回焦时收起伪装
const wrong = "coverActive && coverByBlur && !autoRestoreOnFocusEnabled()";
const right = "coverActive && coverByBlur && autoRestoreOnFocusEnabled()";
const count = text.split(wrong).length - 1;
if (count === 0) throw new Error("未找到需要反转的条件");
text = text.split(wrong).join(right);

writeFileSync(file, text.split("\n").join(eol), "utf8");
console.log(`inverted ${count} condition(s)`);
