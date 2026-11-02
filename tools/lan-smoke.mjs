// 手机侧联机冒烟测试：直接走 sidecar 的 HTTP（SSE 下行 + POST 上行），
// 不经过插件 UI，等价于"一台手机打开中继页面"。
//
// 注意：Windows 防火墙会拦没有放行规则的程序，本机可能连不上自己的端口。
// 如果这里超时，先去「允许应用通过防火墙」放行对应进程。
//
// 用法：node tools/lan-smoke.mjs http://192.168.2.154:3000
const base = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");

function sseClient(id) {
  const events = [];
  const controller = new AbortController();
  const ready = new Promise((resolve, reject) => {
    fetch(`${base}/relay/events?c=${encodeURIComponent(id)}&n=${encodeURIComponent("测试手机")}`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        resolve();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {
                /* 心跳之类的非 JSON 忽略 */
              }
            }
          }
        }
      })
      .catch((error) => reject(error));
  });
  return { events, ready, close: () => controller.abort() };
}

async function send(id, message) {
  const response = await fetch(`${base}/relay/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ c: id, msg: message }),
  });
  if (!response.ok) throw new Error(`send failed: HTTP ${response.status}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const host = sseClient("smoke-host");
const guest = sseClient("smoke-guest");
try {
  await host.ready;
  await guest.ready;
  await send("smoke-host", { t: "create", name: "房主" });
  await wait(300);
  const code = (host.events.find((m) => m.t === "room") || {}).code;
  if (!code) throw new Error("没拿到房间码");
  console.log("房间码:", code);

  await send("smoke-guest", { t: "join", code, name: "手机" });
  await wait(300);
  const guestRoom = guest.events.find((m) => m.t === "room");
  console.log("客人席位:", guestRoom && guestRoom.seat, "房主看到的人数:", (host.events.find((m) => m.t === "peers") || {}).peers?.length);

  await send("smoke-host", { t: "begin", seed: 7, config: {}, seats: [0, 1] });
  await wait(300);
  console.log("客人收到 begin:", guest.events.some((m) => m.t === "begin"));

  await send("smoke-guest", { t: "act", cmd: { hello: 1 } });
  await wait(300);
  const act = host.events.find((m) => m.t === "act");
  console.log("房主收到 act:", act && { seat: act.seat, seq: act.seq, cmd: act.cmd });

  const ok = guest.events.some((m) => m.t === "begin") && act && act.seat === 1;
  console.log(ok ? "\n✅ 中继可用" : "\n❌ 中继行为不符合预期");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error("失败:", error.message);
  console.error("如果是超时，先确认 Windows 防火墙是否放行了该程序。");
  process.exitCode = 1;
} finally {
  host.close();
  guest.close();
}
