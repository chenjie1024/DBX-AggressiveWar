// 用假的 window / document / dbxPlugin 跑一遍插件适配层，验证：
//   1. localStorage 被替换成内存实现（沙箱里真 localStorage 会抛错）
//   2. 启动时能从 host.storage 读回数据
//   3. setItem 之后会把整表写回 host.storage
//   4. 没有 host.storage 时也不崩
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const shimSource = readFileSync(resolve(here, "..", "ui-src", "plugin-shim.js"), "utf8");

// 假 DOM：适配层会在启动时构建伪装层，所以这些节点方法都得有。
// 只实现到"不会炸"的程度，不模拟真实渲染。
function stubNode() {
  const node = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: true,
    scrollTop: 0,
    scrollLeft: 0,
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    setAttribute() {},
    focus() {},
    contains: () => false,
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }),
    querySelector: () => stubNode(),
    querySelectorAll: () => []
  };
  return node;
}

function makeEnv({ stored = null, withStorage = true } = {}) {
  const writes = [];
  const listeners = {};
  const window = {
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    console,
    dbxPlugin: withStorage
      ? {
          capabilities: { storage: true },
          storage: {
            get: async (key) => (key === "gongfa:localStorage" ? stored : null),
            set: async (key, value) => {
              writes.push({ key, value });
            }
          }
        }
      : undefined
  };
  window.addEventListener = (name, fn) => {
    listeners["window:" + name] = fn;
  };
  const document = {
    hidden: false,
    readyState: "complete",
    hasFocus: () => false,
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    createElement: () => stubNode(),
    getElementById: () => stubNode(),
    querySelector: () => stubNode(),
    querySelectorAll: () => [],
    body: stubNode(),
    head: stubNode(),
    title: ""
  };
  const sandbox = { window, document, console, setTimeout, clearTimeout, Promise, navigator: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(shimSource, sandbox);
  return { window, document, writes, listeners };
}

function assert(condition, message) {
  if (!condition) {
    console.error("❌", message);
    process.exitCode = 1;
    return;
  }
  console.log("✅", message);
}

// 1) 首次运行：空存储
{
  const { window } = makeEnv();
  assert(window.__gongfaPlugin.localStorageInstalled, "localStorage 被替换成内存实现");
  window.localStorage.setItem("gongfa-war:autosave", '{"seed":1}');
  assert(window.localStorage.getItem("gongfa-war:autosave") === '{"seed":1}', "写入后能读回");
  assert(window.localStorage.length === 1, "length 正确");
}

// 2) 已有数据：启动时读回
{
  const { window } = makeEnv({ stored: { "gongfa-war:autosave": '{"turn":7}', "gongfa-war.music": "0" } });
  await window.__gongfaPlugin.ready;
  assert(window.localStorage.getItem("gongfa-war:autosave") === '{"turn":7}', "启动时从 host.storage 读回存档");
  assert(window.localStorage.getItem("gongfa-war.music") === "0", "启动时读回设置");
}

// 3) 写入后落盘（去抖 400ms）
{
  const { window, writes } = makeEnv({ stored: { "gongfa-war:autosave": '{"turn":1}' } });
  await window.__gongfaPlugin.ready;
  window.localStorage.setItem("gongfa-war:autosave", '{"turn":2}');
  await new Promise((r) => setTimeout(r, 700));
  const last = writes[writes.length - 1];
  assert(last && last.key === "gongfa:localStorage", "写回 host.storage 使用的是固定 key");
  assert(last && last.value["gongfa-war:autosave"] === '{"turn":2}', "写回内容是最新值");
  assert(writes.length === 1, "合并成一次写（去抖生效）");
}

// 4) 没有 storage 时降级且不崩
{
  const { window } = makeEnv({ withStorage: false });
  assert(window.__gongfaPlugin.storage === false, "无 host.storage 时标记为不可用");
  window.localStorage.setItem("x", "1");
  assert(window.localStorage.getItem("x") === "1", "无存储时仍是可用的内存实现");
  const state = await window.__gongfaPlugin.ready;
  assert(state === false, "ready 解析为 false");
}

console.log(process.exitCode ? "\n有失败项" : "\n全部通过");
