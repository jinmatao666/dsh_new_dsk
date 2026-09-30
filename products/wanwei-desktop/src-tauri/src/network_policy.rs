use std::sync::Mutex;
use tauri::{Manager, State};
use url::Url;

pub struct NetworkPolicy(pub Mutex<(bool, Vec<String>)>);
impl Default for NetworkPolicy {
    fn default() -> Self { Self(Mutex::new((false, Vec::new()))) }
}
pub fn internal_link(url: &Url, origins: &[String]) -> bool {
    if origins.iter().any(|origin| *origin == url.origin().ascii_serialization()) { return true; }
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']).to_lowercase();
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
            std::net::IpAddr::V6(ip) => ip.is_loopback() || (ip.segments()[0] & 0xfe00 == 0xfc00)
                || (ip.segments()[0] & 0xffc0 == 0xfe80),
        };
    }
    !host.is_empty() && (!host.contains('.') || host == "localhost" || host.ends_with(".localhost")
        || host.ends_with(".local") || host.ends_with(".internal") || host.ends_with(".lan"))
}
pub fn internet_enabled(app: &tauri::AppHandle) -> bool {
    app.state::<NetworkPolicy>().0.lock().map(|value| value.0).unwrap_or(false)
}
pub fn may_open(app: &tauri::AppHandle, url: &Url) -> bool {
    app.state::<NetworkPolicy>().0.lock().map(|value| value.0 || internal_link(url, &value.1)).unwrap_or(false)
}
#[tauri::command]
pub fn set_network_environment(mode: String, internal_origins: Vec<String>, policy: State<'_, NetworkPolicy>) -> Result<(), String> {
    if mode != "internet" && mode != "intranet" { return Err("网络环境无效".into()); }
    let origins = internal_origins.into_iter().map(|origin| Url::parse(&origin)
        .map(|url| url.origin().ascii_serialization()).map_err(|_| "服务地址无效".to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    *policy.0.lock().map_err(|_| "网络环境状态不可用".to_string())? = (mode == "internet", origins);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::internal_link;
    use url::Url;
    #[test]
    fn distinguishes_public_and_internal_links() {
        for link in ["http://10.1.2.3/", "https://192.168.2.3/", "http://172.20.0.2/", "http://[::1]/", "http://server.lan/"] {
            assert!(internal_link(&Url::parse(link).unwrap(), &[]));
        }
        for link in ["https://docs.qq.com/", "http://172.32.0.1/", "https://localhost.example.com/"] {
            assert!(!internal_link(&Url::parse(link).unwrap(), &[]));
        }
        assert!(internal_link(&Url::parse("https://deployment.example.com/x").unwrap(), &["https://deployment.example.com".into()]));
    }
}
