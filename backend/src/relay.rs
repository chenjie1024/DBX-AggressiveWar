//! 锁步联机中继 + 静态托管。
//!
//! 为什么不是 WebSocket：游戏客户端用 `WebSocket` 连 `/relay`，但 Rust 侧要手写
//! RFC6455 帧（还要 SHA-1）成本高、风险大。于是换一条等价通道：
//!   · 手机等浏览器页面 → **SSE 下行 + POST 上行**（游戏里由适配层把 WebSocket 换掉）
//!   · 插件自己的 UI     → **宿主 RPC 桥**（沙箱里连不上本机端口，只能走宿主）
//! 中继协议本身与游戏原有实现保持一致（create / join / begin / act / peers / error）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::mpsc as tokio_mpsc;

/// 一条客户端连接的下行通道。
#[derive(Clone)]
pub enum Sink {
    /// SSE / 其它异步发送端
    Channel(tokio_mpsc::UnboundedSender<String>),
    /// 插件 UI：通过宿主事件把消息推回沙箱
    Callback(Arc<dyn Fn(&str) + Send + Sync>),
}

impl Sink {
    fn send(&self, text: &str) {
        match self {
            Sink::Channel(tx) => {
                let _ = tx.send(text.to_string());
            }
            Sink::Callback(callback) => callback(text),
        }
    }
}

struct Client {
    name: String,
    room: Option<String>,
    seat: i64,
    sink: Sink,
    /// 下行消息队列：插件 UI 用轮询取走（事件通道在部分宿主上不可靠）
    queue: std::collections::VecDeque<String>,
    connected: bool,
}

struct Peer {
    seat: i64,
    name: String,
    client: Option<String>,
    connected: bool,
}

struct Room {
    code: String,
    peers: Vec<Peer>,
    started: bool,
    seed: u64,
    config: Value,
    seats: Value,
    log: Vec<(i64, Value)>,
    seq: u64,
}

pub struct Hub {
    clients: HashMap<String, Client>,
    rooms: HashMap<String, Room>,
    counter: u64,
}

const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

impl Hub {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            rooms: HashMap::new(),
            counter: 0,
        }
    }

    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    pub fn register(&mut self, id: &str, name: &str, sink: Sink) {
        self.clients.insert(
            id.to_string(),
            Client {
                name: name.to_string(),
                room: None,
                seat: -1,
                sink,
                queue: std::collections::VecDeque::new(),
                connected: true,
            },
        );
    }

    pub fn unregister(&mut self, id: &str) {
        let room_code = self.clients.get(id).and_then(|c| c.room.clone());
        let seat = self.clients.get(id).map(|c| c.seat).unwrap_or(-1);
        self.clients.remove(id);
        if let Some(code) = room_code {
            let mut out: Vec<(String, Value)> = Vec::new();
            if let Some(room) = self.rooms.get_mut(&code) {
                if let Some(peer) = room.peers.iter_mut().find(|p| p.seat == seat) {
                    peer.connected = false;
                    peer.client = None;
                }
                let peers = peers_of(room);
                for peer in &room.peers {
                    if let Some(client_id) = &peer.client {
                        out.push((client_id.clone(), json!({ "t": "peers", "peers": peers })));
                    }
                }
            }
            self.flush(out);
        }
    }

    fn next_code(&mut self) -> String {
        loop {
            self.counter = self.counter.wrapping_add(1);
            let seed = (self.counter as u128) * 2654435761u128 + 0x9e3779b9;
            let mut code = String::new();
            for i in 0..4 {
                let index = ((seed >> (i * 7)) % CHARS.len() as u128) as usize;
                code.push(CHARS[index] as char);
            }
            if !self.rooms.contains_key(&code) {
                return code;
            }
        }
    }

    fn flush(&mut self, out: Vec<(String, Value)>) {
        for (client_id, message) in out {
            if let Some(client) = self.clients.get_mut(&client_id) {
                let text = message.to_string();
                client.queue.push_back(text.clone());
                // 队列有上限：万一 UI 不再轮询，别把内存吃光
                while client.queue.len() > 256 {
                    client.queue.pop_front();
                }
                client.sink.send(&text);
            }
        }
    }

    /// 取走该客户端排队的下行消息（插件 UI 的轮询入口）。
    pub fn poll(&mut self, id: &str) -> Vec<String> {
        match self.clients.get_mut(id) {
            Some(client) => client.queue.drain(..).collect(),
            None => Vec::new(),
        }
    }

    /// 处理一条客户端消息（JSON 文本）。
    pub fn handle(&mut self, id: &str, raw: &str) {
        let message: Value = match serde_json::from_str(raw) {
            Ok(value) => value,
            Err(_) => {
                self.reply(id, json!({ "t": "error", "message": "消息格式错误" }));
                return;
            }
        };
        let kind = message.get("t").and_then(Value::as_str).unwrap_or("");
        let mut out: Vec<(String, Value)> = Vec::new();

        match kind {
            "ping" => {
                out.push((id.to_string(), json!({ "t": "pong" })));
                self.flush(out);
                return;
            }
            "create" => {
                let name = message
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("房主")
                    .chars()
                    .take(12)
                    .collect::<String>();
                let code = self.next_code();
                self.rooms.insert(
                    code.clone(),
                    Room {
                        code: code.clone(),
                        peers: vec![Peer {
                            seat: 0,
                            name: name.clone(),
                            client: Some(id.to_string()),
                            connected: true,
                        }],
                        started: false,
                        seed: 0,
                        config: Value::Null,
                        seats: Value::Null,
                        log: Vec::new(),
                        seq: 0,
                    },
                );
                if let Some(client) = self.clients.get_mut(id) {
                    client.room = Some(code.clone());
                    client.seat = 0;
                    client.name = name;
                }
                let room = self.rooms.get(&code).unwrap();
                out.push((id.to_string(), room_info(room, 0)));
                self.flush(out);
                return;
            }
            "join" => {
                let code = message
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_uppercase();
                if !self.rooms.contains_key(&code) {
                    self.reply(id, json!({ "t": "error", "message": "房间不存在（检查房间码）" }));
                    return;
                }
                // 已在本房间：沿用原席位，补发进度
                let current = self.clients.get(id).map(|c| (c.room.clone(), c.seat));
                if let Some((Some(room), seat)) = current.clone() {
                    if room == code {
                        let room = self.rooms.get(&code).unwrap();
                        out.push((id.to_string(), room_info(room, seat)));
                        if room.started {
                            out.push((
                                id.to_string(),
                                json!({ "t": "begin", "seed": room.seed, "config": room.config, "seats": room.seats }),
                            ));
                            for (seat, cmd) in &room.log {
                                out.push((
                                    id.to_string(),
                                    json!({ "t": "act", "seat": seat, "seq": 0, "cmd": cmd }),
                                ));
                            }
                        }
                        self.flush(out);
                        return;
                    }
                }
                let name = message
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("玩家")
                    .chars()
                    .take(12)
                    .collect::<String>();
                let room = self.rooms.get_mut(&code).unwrap();
                let free = room.peers.iter().position(|p| !p.connected);
                let seat = match free {
                    Some(index) => {
                        let peer = &mut room.peers[index];
                        peer.client = Some(id.to_string());
                        peer.connected = true;
                        peer.name = name.clone();
                        peer.seat
                    }
                    None => {
                        if room.peers.len() >= 6 {
                            self.reply(id, json!({ "t": "error", "message": "房间已满（最多 6 方）" }));
                            return;
                        }
                        let seat = room.peers.len() as i64;
                        room.peers.push(Peer {
                            seat,
                            name: name.clone(),
                            client: Some(id.to_string()),
                            connected: true,
                        });
                        seat
                    }
                };
                if let Some(client) = self.clients.get_mut(id) {
                    client.room = Some(code.clone());
                    client.seat = seat;
                    client.name = name;
                }
                let room = self.rooms.get(&code).unwrap();
                out.push((id.to_string(), room_info(room, seat)));
                if room.started {
                    out.push((
                        id.to_string(),
                        json!({ "t": "begin", "seed": room.seed, "config": room.config, "seats": room.seats }),
                    ));
                    for (seat, cmd) in &room.log {
                        out.push((id.to_string(), json!({ "t": "act", "seat": seat, "seq": 0, "cmd": cmd })));
                    }
                }
                let peers = peers_of(room);
                for peer in &room.peers {
                    if let Some(client_id) = &peer.client {
                        out.push((client_id.clone(), json!({ "t": "peers", "peers": peers })));
                    }
                }
                self.flush(out);
                return;
            }
            _ => {}
        }

        // 以下都需要已在房间里
        let Some((Some(code), seat)) = self.clients.get(id).map(|c| (c.room.clone(), c.seat)) else {
            self.reply(id, json!({ "t": "error", "message": "尚未加入房间" }));
            return;
        };

        match kind {
            "begin" => {
                if seat != 0 {
                    self.reply(id, json!({ "t": "error", "message": "只有房主能开局" }));
                    return;
                }
                let Some(room) = self.rooms.get_mut(&code) else { return };
                room.started = true;
                room.seed = message.get("seed").and_then(Value::as_u64).unwrap_or(0);
                room.config = message.get("config").cloned().unwrap_or(Value::Null);
                room.seats = message.get("seats").cloned().unwrap_or(Value::Null);
                room.log.clear();
                let begin = json!({ "t": "begin", "seed": room.seed, "config": room.config, "seats": room.seats });
                for peer in &room.peers {
                    if let Some(client_id) = &peer.client {
                        out.push((client_id.clone(), begin.clone()));
                    }
                }
            }
            "act" => {
                let Some(room) = self.rooms.get_mut(&code) else { return };
                if !room.started {
                    self.reply(id, json!({ "t": "error", "message": "对局还没开始" }));
                    return;
                }
                let cmd = message.get("cmd").cloned().unwrap_or(Value::Null);
                room.log.push((seat, cmd.clone()));
                room.seq += 1;
                let seq = room.seq;
                let act = json!({ "t": "act", "seat": seat, "seq": seq, "cmd": cmd });
                for peer in &room.peers {
                    if let Some(client_id) = &peer.client {
                        out.push((client_id.clone(), act.clone()));
                    }
                }
            }
            other => {
                out.push((
                    id.to_string(),
                    json!({ "t": "error", "message": format!("未知消息：{other}") }),
                ));
            }
        }
        self.flush(out);
    }

    fn reply(&self, id: &str, message: Value) {
        if let Some(client) = self.clients.get(id) {
            client.sink.send(&message.to_string());
        }
    }
}

fn peers_of(room: &Room) -> Value {
    Value::Array(
        room.peers
            .iter()
            .map(|peer| {
                json!({ "seat": peer.seat, "name": peer.name, "connected": peer.connected })
            })
            .collect(),
    )
}

fn room_info(room: &Room, seat: i64) -> Value {
    json!({
        "t": "room",
        "code": room.code,
        "seat": seat,
        "host": seat == 0,
        "peers": peers_of(room),
        "started": room.started,
    })
}

pub type SharedHub = Arc<Mutex<Hub>>;

pub fn shared() -> SharedHub {
    Arc::new(Mutex::new(Hub::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connect(hub: &SharedHub, id: &str) -> tokio_mpsc::UnboundedReceiver<String> {
        let (tx, rx) = tokio_mpsc::unbounded_channel();
        hub.lock().unwrap().register(id, "", Sink::Channel(tx));
        rx
    }

    fn take(rx: &mut tokio_mpsc::UnboundedReceiver<String>) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok(text) = rx.try_recv() {
            out.push(serde_json::from_str(&text).unwrap());
        }
        out
    }

    #[test]
    fn create_then_join_assigns_seats() {
        let hub = shared();
        let mut host = connect(&hub, "host");
        let mut guest = connect(&hub, "guest");
        hub.lock().unwrap().handle("host", r#"{"t":"create","name":"房主"}"#);
        let host_msgs = take(&mut host);
        let code = host_msgs[0]["code"].as_str().unwrap().to_string();
        assert_eq!(host_msgs[0]["seat"], 0);
        assert_eq!(host_msgs[0]["peers"].as_array().unwrap().len(), 1);

        hub.lock()
            .unwrap()
            .handle("guest", &format!(r#"{{"t":"join","code":"{code}","name":"客人"}}"#));
        let guest_msgs = take(&mut guest);
        assert_eq!(guest_msgs[0]["seat"], 1);
        assert_eq!(guest_msgs[0]["host"], false);
        let host_after = take(&mut host);
        assert!(host_after.iter().any(|m| m["t"] == "peers" && m["peers"].as_array().unwrap().len() == 2));
    }

    #[test]
    fn begin_and_act_broadcast_in_order_with_replay() {
        let hub = shared();
        let mut host = connect(&hub, "host");
        let mut guest = connect(&hub, "guest");
        let mut late = connect(&hub, "late");
        hub.lock().unwrap().handle("host", r#"{"t":"create"}"#);
        let code = take(&mut host)[0]["code"].as_str().unwrap().to_string();
        hub.lock()
            .unwrap()
            .handle("guest", &format!(r#"{{"t":"join","code":"{code}"}}"#));
        take(&mut guest);
        take(&mut host);

        hub.lock()
            .unwrap()
            .handle("host", r#"{"t":"begin","seed":7,"config":{"a":1},"seats":[1,2]}"#);
        let host_begin = take(&mut host);
        assert!(host_begin.iter().any(|m| m["t"] == "begin" && m["seed"] == 7));

        hub.lock().unwrap().handle("guest", r#"{"t":"act","cmd":{"k":1}}"#);
        let host_acts: Vec<Value> = take(&mut host).into_iter().filter(|m| m["t"] == "act").collect();
        assert_eq!(host_acts.len(), 1);
        assert_eq!(host_acts[0]["seq"], 1);
        assert_eq!(host_acts[0]["seat"], 1);

        // 后加入者要能拿到 begin + 历史指令
        hub.lock()
            .unwrap()
            .handle("late", &format!(r#"{{"t":"join","code":"{code}"}}"#));
        let late_msgs = take(&mut late);
        assert!(late_msgs.iter().any(|m| m["t"] == "begin"));
        assert!(late_msgs.iter().any(|m| m["t"] == "act"));
    }

    #[test]
    fn guest_cannot_begin_before_join() {
        let hub = shared();
        let mut guest = connect(&hub, "guest");
        hub.lock().unwrap().handle("guest", r#"{"t":"begin","seed":1}"#);
        let msgs = take(&mut guest);
        assert!(msgs.iter().any(|m| m["t"] == "error" && m["message"] == "尚未加入房间"));
    }

    #[test]
    fn unknown_room_reports_error() {
        let hub = shared();
        let mut guest = connect(&hub, "guest");
        hub.lock().unwrap().handle("guest", r#"{"t":"join","code":"ZZZZ"}"#);
        let msgs = take(&mut guest);
        assert!(msgs.iter().any(|m| m["t"] == "error"));
    }
}
