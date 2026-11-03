import { readFileSync, writeFileSync } from "node:fs";

const file = "D:/projiect/dbx/gongfawar/ui-src/plugin-shim.js";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(eol);

if (!lines.some((l) => l.includes(".cv-sql::selection"))) {
  const anchor = lines.findIndex((l) => l.includes(".cv-sql::-webkit-scrollbar"));
  if (anchor < 0) throw new Error("anchor missing");
  lines.splice(anchor, 0, '    "#dbx-cover .cv-sql::selection{background:#264f78}",');
}

if (!lines.some((l) => l.includes(".cv-hl .k{"))) {
  const anchor = lines.findIndex((l) => l.includes(".cv-hl .s{color:#86efac}"));
  if (anchor < 0) throw new Error("kw anchor missing");
  lines.splice(anchor, 0, '    "#dbx-cover .cv-hl .k{color:#7dd3fc}",');
}

writeFileSync(file, lines.join(eol), "utf8");
console.log("restored selection + keyword rule");
