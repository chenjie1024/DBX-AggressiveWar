//! 攻伐战争插件的 sidecar：给「本地局域网联机」当宿主。
//!
//! 职责只有两件：
//!   1. 在宿主机上托管游戏页面（手机连同一个 WiFi 打开就能玩）；
//!   2. 跑锁步联机中继（房间/席位/指令广播）。
//!
//! 插件 UI 在沙箱里连不了本机端口，所以它通过下面的 RPC（lan/ws*）接到同一个中继上。

use std::sync::{Mutex, OnceLock};

use dbx_plugin_sdk::{
    PluginEmitter, PluginError, PluginHandler, PluginMetadata, PluginServer, RequestContext,
};
use serde_json::{json, Value};

mod assets;
mod relay;
mod server;

const DEFAULT_PORT: u16 = 3000;

struct LanState {
    server: Option<server::LanServer>,
    hub: relay::SharedHub,
}

static LAN: OnceLock<Mutex<LanState>> = OnceLock::new();

fn lan() -> &'static Mutex<LanState> {
    LAN.get_or_init(|| {
        Mutex::new(LanState {
            server: None,
            hub: relay::shared(),
        })
    })
}

struct Plugin;

impl Default for Plugin {
    fn default() -> Self {
        Self
    }
}

impl Plugin {
    fn lan_start(&self, params: &Value) -> Result<Value, PluginError> {
        let port = params
            .get("port")
            .and_then(Value::as_u64)
            .map(|value| value as u16)
            .unwrap_or(DEFAULT_PORT);
        let mut state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        if state.server.is_none() {
            let server = server::start(port, state.hub.clone())
                .map_err(|message| PluginError::new(-32000, message))?;
            state.server = Some(server);
        }
        let server = state.server.as_ref().unwrap();
        Ok(json!({
            "ok": true,
            "port": server.port,
            "urls": server.urls,
            "reachable": server.reachable,
            "rooms": state.hub.lock().map(|hub| hub.room_count()).unwrap_or(0),
        }))
    }

    fn lan_stop(&self) -> Result<Value, PluginError> {
        let mut state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        if let Some(mut server) = state.server.take() {
            server.stop();
        }
        Ok(json!({ "ok": true }))
    }

    fn lan_status(&self) -> Result<Value, PluginError> {
        let state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        let rooms = state.hub.lock().map(|hub| hub.room_count()).unwrap_or(0);
        match state.server.as_ref() {
            Some(server) => {
                // 优先给局域网地址做二维码：手机扫了就能打开，127.0.0.1 对手机没意义
                let share_url = server
                    .urls
                    .iter()
                    .find(|url| !url.contains("127.0.0.1"))
                    .cloned()
                    .or_else(|| server.urls.first().cloned());
                Ok(json!({
                    "running": true,
                    "port": server.port,
                    "urls": server.urls,
                    "shareUrl": share_url,
                    // 二维码里就是这串地址，UI 会把它显示在图形下方，便于人工核对
                    "qrText": share_url,
                    "qrSvg": share_url.as_deref().and_then(server::qr_svg),
                    // 每次查询都重新探测：Windows 防火墙的拦截可能是延迟生效的，
                    // 启动瞬间能连通并不代表现在还能连通。
                    "reachable": server::probe_reachable(server.port),
                    "rooms": rooms,
                }))
            }
            None => Ok(json!({ "running": false, "rooms": 0 })),
        }
    }

    /// 插件 UI 的"虚拟 WebSocket"：注册一条走宿主事件的下行通道。
    fn lan_ws_open(&self, params: &Value, emitter: &PluginEmitter) -> Result<Value, PluginError> {
        let id = require_str(params, "id")?.to_string();
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("房主")
            .to_string();
        let state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        if state.server.is_none() {
            return Err(PluginError::new(-32000, "中继还没有启动"));
        }
        let emitter = emitter.clone();
        let client_id = id.clone();
        let sink = relay::Sink::Callback(std::sync::Arc::new(move |text: &str| {
            let _ = emitter.event(
                "lan/message",
                json!({ "id": client_id, "data": text }),
            );
        }));
        state
            .hub
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?
            .register(&id, &name, sink);
        Ok(json!({ "ok": true }))
    }

    fn lan_ws_send(&self, params: &Value) -> Result<Value, PluginError> {
        let id = require_str(params, "id")?;
        let data = require_str(params, "data")?;
        if data.len() > 64 * 1024 {
            return Err(PluginError::new(-32602, "联机消息过长"));
        }
        let state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        state
            .hub
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?
            .handle(id, data);
        Ok(json!({ "ok": true }))
    }

    /// 插件 UI 的轮询入口：取走该连接排队的中继消息。
    fn lan_poll(&self, params: &Value) -> Result<Value, PluginError> {
        let id = require_str(params, "id")?;
        let state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        let messages = state
            .hub
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?
            .poll(id);
        Ok(json!({ "messages": messages }))
    }

    fn lan_ws_close(&self, params: &Value) -> Result<Value, PluginError> {
        let id = require_str(params, "id")?;
        let state = lan()
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?;
        state
            .hub
            .lock()
            .map_err(|_| PluginError::new(-32000, "联机状态不可用"))?
            .unregister(id);
        Ok(json!({ "ok": true }))
    }
}

impl PluginHandler for Plugin {
    fn handle(
        &self,
        _context: RequestContext,
        method: &str,
        params: Value,
        emitter: &PluginEmitter,
    ) -> Result<Value, PluginError> {
        match method {
            "connection/test" => Ok(json!({ "success": true, "message": "攻伐战争联机就绪" })),
            "lan/start" => self.lan_start(&params),
            "lan/stop" => self.lan_stop(),
            "lan/status" => self.lan_status(),
            "lan/wsOpen" => self.lan_ws_open(&params, emitter),
            "lan/wsSend" => self.lan_ws_send(&params),
            "lan/poll" => self.lan_poll(&params),
            "lan/wsClose" => self.lan_ws_close(&params),
            _ => Err(PluginError::method_not_found(method)),
        }
    }
}

fn require_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, PluginError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PluginError::new(-32602, format!("缺少参数 {key}")))
}

fn main() -> std::io::Result<()> {
    // 供 server::start 做"跨进程可达性自检"：连一次自己的端口就退出。
    // 同进程连自己不受防火墙过滤，只有另一个进程才等价于"手机能不能连上"。
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "--probe" {
        // 参数可以是 "3000"（默认 loopback）或 "host:port"
        let raw = &args[2];
        let target = match raw.parse::<u16>() {
            Ok(port) => std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Err(_) => match raw.parse::<std::net::SocketAddr>() {
                Ok(addr) => addr,
                Err(_) => std::process::exit(2),
            },
        };
        let ok = std::net::TcpStream::connect_timeout(&target, std::time::Duration::from_millis(900)).is_ok();
        std::process::exit(if ok { 0 } else { 1 });
    }

    let metadata = PluginMetadata::new("com.xingxi.game", env!("CARGO_PKG_VERSION"))
        .with_capability("workbench");
    PluginServer::new(metadata, Plugin).serve()
}
