# AggressiveWar · DBX 插件

把 [`aggressiveWar`](https://github.com/chenjie1024/aggressiveWar) 这个网页游戏搬进 DBX：
在插件工作台里开局、下兵、结束回合，存档自动保存到 DBX 的插件存储里。

- 插件 id：`com.gongfawar.game`
- 平台：**universal**（前端 + Rust sidecar：本地局域网联机中继）
- 权限：只有 `host.storage`（sidecar 监听端口不需要额外权限）
- 包体积：约 **1.5 MB**（含 sidecar）

## 它是怎么工作的

游戏本身是标准网页应用（Vite + Canvas 2D，逻辑在纯 TS 的 `packages/core`）。插件只做三件事：

1. **把游戏构建产物放进 `ui/`**（`node tools/build-ui.mjs`，从游戏仓库直接构建，不改游戏源码）。
2. **注入适配层 `ui/plugin-shim.js`**：DBX 插件 UI 跑在 opaque-origin 沙箱里，访问
   `localStorage` 会直接抛错。适配层提供一份内存实现，并在背后同步到 `host.storage`，
   于是游戏的自动存档、设置、成就都能跨重启保留。
3. **拦掉 `/api/*` 请求**：插件里没有游戏服务器，直接回绝比让它撞 CSP 更干净；
   游戏自己的兜底会把存档写到本地（`💾 服务器不可用，已保存到本地`）。

## 开发

```bash
# 1) 构建 UI（默认从 ..\..\aggressiveWar 取游戏源码）
node tools/build-ui.mjs
#    或指定仓库路径
GONGFA_REPO=D:\projiect\aggressiveWar node tools/build-ui.mjs

# 2) 适配层单测（假宿主 + node:vm）
node tools/test-shim.mjs

# 3) 本地调试
dbx-plugin dev --path . --port 5191

# 4) 打包
dbx-plugin package .
# 产物：dist/com.gongfawar.game-<ver>-universal.dbxp
```

## 伪装主界面（打开即见）

插件一打开就是它，长这样：

- **顶部**：`◧ DBX` + 连接/数据库下拉 + 检索框 + 状态 + 「▶ 运行」+ 右上角 ⚙
- **中间**：`query-1.sql` 标签页 + 可编辑的 SQL 编辑器（**行号 + 语法高亮**：关键字、字符串、注释、数字、函数各自上色，Tab 插入缩进）
- **下面**：结果表格（14 行订单，支持检索过滤、复制、导出 CSV、点「运行」刷新耗时）
- **底部**：`prod-mysql · readonly` / 时间 / `utf8mb4`
- **⚙ 设置**：老板键**按键录制**（点一下按钮，直接按组合键，Esc 取消）、离开时自动伪装、切回 DBX 时也保持伪装、打开时先显示本界面、「进入游戏」

伪装时会冻结游戏的 requestAnimationFrame 渲染循环（实测 60fps → 0fps），不再在后台空转耗电；恢复时把排队的帧回调补发，循环自然接上。`n`n细节：伪装时标签标题是 **DBX**；进入游戏后标题是 **AggressiveWar**；伪装层自己的输入框能正常打字，
但游戏键位（空格/方向键等）被吞掉，不会误触。时自动往后找），**托管游戏页面**；
2. 跑**锁步中继**（房间码 / 席位 / 指令广播）。

两边怎么连（同一个中继，两种通道）：

| 谁 | 通道 | 原因 |
|---|---|---|
| 插件里的房主 | 宿主 RPC（`lan/wsOpen` + `lan/wsSend` + `lan/poll` 轮询） | 沙箱连不了本机端口 |
| 手机 / 其它设备 | 页面里的 **SSE + POST** | 浏览器原生支持，且不依赖 WebSocket 帧 |

用法：右下角「🌐 联机」→ 启动中继 → **手机扫面板里的二维码**（或复制地址）；游戏菜单里「本地局域网联机」→ 创建房间 →
手机连同一 WiFi 打开 `http://<电脑IP>:3000` → 输入房间码加入 → 房主点「开始对局」。

> **Windows 防火墙**：没放行过的程序，端口能监听但连不上（本机 curl 也会超时）。
> 到「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」放行 DBX 即可。
> 面板里的「reachable」就是拿子进程探测出来的真实结果，不是猜的。
