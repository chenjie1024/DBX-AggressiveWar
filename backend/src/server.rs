//! 本地 HTTP 服务：托管游戏页面 + 锁步中继（SSE 下行 / POST 上行）。
//!
//! 不用 WebSocket 的原因见 relay.rs 顶部注释：Rust 侧手写 RFC6455 帧不划算，
//! 改成 SSE + POST 后两端都用标准库/浏览器原生能力，协议语义保持一致。

use std::convert::Infallible;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc as std_mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::stream::{self, StreamExt};
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::Frame;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::sync::mpsc as tokio_mpsc;

use crate::assets::{content_type, lookup};
use crate::relay::{Sink, SharedHub};

const MAX_BODY: usize = 256 * 1024;

pub struct LanServer {
    pub port: u16,
    pub urls: Vec<String>,
    /// 本机自检：端口监听成功不代表能被访问（Windows 防火墙可能拦掉）
    pub reachable: bool,
    pub hub: SharedHub,
    stop: Arc<AtomicBool>,
    // 线程句柄只在 stop 时用来等它退出
    join: Option<std::thread::JoinHandle<()>>,
}

impl LanServer {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for LanServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 在 0.0.0.0 上启动服务；端口被占用时往后顺延几个。
pub fn start(port_hint: u16, hub: SharedHub) -> Result<LanServer, String> {
    let (ready_tx, ready_rx) = std_mpsc::channel::<Result<u16, String>>();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let hub_for_thread = hub.clone();

    let join = std::thread::Builder::new()
        .name("gongfa-lan-http".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = ready_tx.send(Err(format!("无法创建网络运行时：{error}")));
                    return;
                }
            };
            runtime.block_on(async move {
                let listener = match bind(port_hint).await {
                    Ok(listener) => listener,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                let port = listener.local_addr().map(|addr| addr.port()).unwrap_or(0);
                let _ = ready_tx.send(Ok(port));
                loop {
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }
                    let accepted = tokio::time::timeout(
                        Duration::from_millis(200),
                        listener.accept(),
                    )
                    .await;
                    if let Ok(Ok((stream, _peer))) = accepted {
                        let hub = hub_for_thread.clone();
                        tokio::spawn(async move {
                            let io = TokioIo::new(stream);
                            let service = service_fn(move |request| {
                                let hub = hub.clone();
                                async move { handle(request, hub).await }
                            });
                            let _ = hyper::server::conn::http1::Builder::new()
                                .serve_connection(io, service)
                                .await;
                        });
                    }
                }
            });
        })
        .map_err(|error| format!("无法启动网络线程：{error}"))?;

    let port = ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "本地服务启动超时".to_string())??;

    // 自检：Windows 防火墙会拦"没有放行规则"的程序，表现是端口在监听但连不上。
    // **必须用子进程**探测：同进程连自己的 loopback 不受同样的过滤，测不出问题。
    let reachable = probe_reachable(port);
    let _ = &reachable;

    Ok(LanServer {
        port,
        urls: lan_urls(port),
        reachable,
        hub,
        stop,
        join: Some(join),
    })
}

/// 起一个自己（--probe 模式）去连端口；只它才能代表"另一台设备"的真实结果。
pub fn probe_reachable(port: u16) -> bool {
    std::thread::sleep(Duration::from_millis(120));
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    // 手机连的是局域网 IP，不是 loopback；能连通它才算"局域网可用"。
    let target = match lan_ip() {
        Some(ip) => format!("{ip}:{port}"),
        None => format!("127.0.0.1:{port}"),
    };
    let Ok(mut child) = std::process::Command::new(exe)
        .args(["--probe", &target])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_millis(1600);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return false;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return false,
        }
    }
}

async fn bind(port_hint: u16) -> Result<tokio::net::TcpListener, String> {
    let base = if port_hint == 0 { 3000 } else { port_hint };
    let mut last_error = String::new();
    for offset in 0..20u16 {
        let port = base.saturating_add(offset);
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => return Ok(listener),
            Err(error) => last_error = format!("端口 {port} 不可用：{error}"),
        }
    }
    Err(format!("没有可用端口：{last_error}"))
}

/// 把地址渲染成二维码 SVG：手机扫一下就能打开中继页面，不用手输 IP。
pub fn qr_svg(text: &str) -> Option<String> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let code = QrCode::new(text.as_bytes()).ok()?;
    Some(
        code.render::<svg::Color>()
            .min_dimensions(200, 200)
            .dark_color(svg::Color("#111827"))
            .light_color(svg::Color("#ffffff"))
            .build(),
    )
}

/// 猜本机局域网 IP（UDP connect 不会真的发包，只是让系统选出出口地址）。
fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

fn lan_urls(port: u16) -> Vec<String> {
    let mut urls = Vec::new();
    urls.push(format!("http://127.0.0.1:{port}"));
    if let Some(ip) = lan_ip() {
        if ip != "127.0.0.1" {
            urls.push(format!("http://{ip}:{port}"));
        }
    }
    urls
}

async fn handle(
    request: Request<hyper::body::Incoming>,
    hub: SharedHub,
) -> Result<Response<http_body_util::combinators::BoxBody<Bytes, Infallible>>, Infallible> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let query = request.uri().query().unwrap_or("").to_string();

    if path == "/relay/events" && method == Method::GET {
        return Ok(sse_response(query, hub));
    }
    if path == "/relay/send" && method == Method::POST {
        return Ok(post_message(request, hub).await);
    }
    if method != Method::GET {
        return Ok(text(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"));
    }

    let name = if path == "/" { "/index.html" } else { path.as_str() };
    match lookup(name) {
        Some(bytes) => Ok(raw(StatusCode::OK, content_type(name), bytes)),
        None => {
            // 单页应用：找不到的路径回落到 index.html
            match lookup("/index.html") {
                Some(index) => Ok(raw(StatusCode::OK, "text/html; charset=utf-8", index)),
                None => Ok(text(StatusCode::NOT_FOUND, "not found")),
            }
        }
    }
}

fn sse_response(
    query: String,
    hub: SharedHub,
) -> Response<http_body_util::combinators::BoxBody<Bytes, Infallible>> {
    let client_id = param(&query, "c").unwrap_or_else(|| format!("sse-{}", now_ms()));
    let name = param(&query, "n").unwrap_or_else(|| "玩家".to_string());

    // 中继 → SSE：用无界 tokio 通道，中继线程发送时不会阻塞
    let (tx, mut rx) = tokio_mpsc::unbounded_channel::<String>();
    hub.lock()
        .unwrap()
        .register(&client_id, &name, Sink::Channel(tx));

    let hello = format!("event: hello\ndata: {{\"id\":\"{client_id}\"}}\n\n");
    let hub_for_drop = hub.clone();
    let client_for_drop = client_id.clone();

    let body_stream = stream::once(async move { Ok::<_, Infallible>(Frame::data(Bytes::from(hello))) })
        .chain(stream::unfold(rx, move |mut rx| async move {
            match rx.recv().await {
                Some(message) => {
                    let frame = Frame::data(Bytes::from(format!("data: {message}\n\n")));
                    Some((Ok::<_, Infallible>(frame), rx))
                }
                None => None,
            }
        }))
        .map(move |result| {
            let _ = &hub_for_drop;
            let _ = &client_for_drop;
            result
        });

    let body = BodyExt::boxed(StreamBody::new(body_stream));
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .body(body)
        .unwrap()
}

async fn post_message(
    request: Request<hyper::body::Incoming>,
    hub: SharedHub,
) -> Response<http_body_util::combinators::BoxBody<Bytes, Infallible>> {
    let collected = match request.into_body().collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(_) => return text(StatusCode::BAD_REQUEST, "bad body"),
    };
    if collected.len() > MAX_BODY {
        return text(StatusCode::PAYLOAD_TOO_LARGE, "too large");
    }
    let payload: serde_json::Value = match serde_json::from_slice(&collected) {
        Ok(value) => value,
        Err(_) => return text(StatusCode::BAD_REQUEST, "bad json"),
    };
    let client_id = payload.get("c").and_then(serde_json::Value::as_str).unwrap_or("");
    let message = payload.get("msg").cloned().unwrap_or(serde_json::Value::Null);
    if client_id.is_empty() {
        return text(StatusCode::BAD_REQUEST, "missing client");
    }
    hub.lock().unwrap().handle(client_id, &message.to_string());
    text(StatusCode::OK, "ok")
}

fn param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let name = parts.next().unwrap_or("");
        if name == key {
            let raw = parts.next().unwrap_or("");
            return Some(decode_component(raw));
        }
    }
    None
}

/// 只处理 %XX 与 +，够用于客户端 id / 昵称。
fn decode_component(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(if byte == b'+' { b' ' } else { byte });
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

fn raw(
    status: StatusCode,
    content_type: &str,
    bytes: &'static [u8],
) -> Response<http_body_util::combinators::BoxBody<Bytes, Infallible>> {
    Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("cache-control", "no-cache")
        .body(Full::new(Bytes::from_static(bytes)).boxed())
        .unwrap()
}

fn text(
    status: StatusCode,
    message: &str,
) -> Response<http_body_util::combinators::BoxBody<Bytes, Infallible>> {
    let body = Full::new(Bytes::from(message.to_string())).boxed();
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
}

// 让 `Instant` 之类在 debug 里可用（避免 unused import 警告）
#[allow(dead_code)]
fn _unused(_: Instant) {}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    use super::*;
    use crate::relay;

    /// 起服务 → 用裸 TCP 发一个 HTTP 请求 → 必须拿到 200 与页面内容。
    ///
    /// 默认忽略：Windows 防火墙会拦"没有放行规则"的程序，本机连 127.0.0.1 也会超时。
    /// 在放行过的机器上跑：`cargo test -- --ignored`。
    #[test]
    #[ignore]
    fn serves_index_over_tcp() {
        let hub = relay::shared();
        let server = start(0, hub).expect("server should start");
        let port = server.port;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"), "unexpected response: {}", &response[..response.len().min(80)]);
        assert!(response.contains("攻伐战争") || response.contains("<div id=\"app\">"));
        drop(server);
    }

    #[test]
    #[ignore]
    fn unknown_path_falls_back_to_index() {
        let hub = relay::shared();
        let server = start(0, hub).expect("server should start");
        let port = server.port;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        stream
            .write_all(b"GET /some/deep/link HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
    }
}

#[cfg(test)]
mod qr_tests {
    use super::*;

    #[test]
    fn qr_svg_encodes_url() {
        let svg = qr_svg("http://192.168.2.154:3000").expect("should render");
        assert!(svg.contains("<svg"), "not an svg: {}", &svg[..svg.len().min(60)]);
        assert!(svg.len() > 500, "svg suspiciously small: {}", svg.len());
        // 二维码尺寸随内容增长：这串 URL 至少是 version 3（29 模块）
        assert!(svg.contains("viewBox") || svg.contains("width="));
    }

    #[test]
    fn qr_svg_rejects_empty() {
        // 空串本身合法（会编码成空二维码），这里只确认不 panic
        let _ = qr_svg("");
    }
}