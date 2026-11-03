// 由 tools/gen-assets.mjs 生成，请勿手改。
pub static ASSETS: &[(&str, &[u8])] = &[
    ("/assets/index-Cax2MEnV.js", include_bytes!("../../ui/assets/index-Cax2MEnV.js") as &[u8]),
    ("/assets/index-DaB20_zY.css", include_bytes!("../../ui/assets/index-DaB20_zY.css") as &[u8]),
    ("/icon-192.png", include_bytes!("../../ui/icon-192.png") as &[u8]),
    ("/icon-512.png", include_bytes!("../../ui/icon-512.png") as &[u8]),
    ("/icon.svg", include_bytes!("../../ui/icon.svg") as &[u8]),
    ("/index.html", include_bytes!("../../ui/index.html") as &[u8]),
    ("/plugin-shim.js", include_bytes!("../../ui/plugin-shim.js") as &[u8]),
];

pub fn lookup(path: &str) -> Option<&'static [u8]> {
    ASSETS
        .iter()
        .find(|(name, _)| *name == path)
        .map(|(_, bytes)| *bytes)
}

pub fn content_type(path: &str) -> &'static str {
    // 注意：这里取到的 ext 不含点（"html"），所以先补一个点再匹配。
    // 之前漏了这一步，所有文件都落进 octet-stream，浏览器打开就变成下载。
    let ext = path.rsplit('.').next().unwrap_or("");
    let dotted = format!(".{ext}");
    match dotted.as_str() {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" => "image/jpeg",
        ".webp" => "image/webp",
        ".woff2" => "font/woff2",
        ".txt" => "text/plain; charset=utf-8",
        ".webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_types_match_dotted_table() {
        assert_eq!(content_type("/index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type("/plugin-shim.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("/assets/index-abc.css"), "text/css; charset=utf-8");
        assert_eq!(content_type("/assets/icon.svg"), "image/svg+xml");
        assert_eq!(content_type("/a/unknown.bin"), "application/octet-stream");
    }
}
