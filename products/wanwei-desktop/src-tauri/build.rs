fn main() {
    let release_version = std::env::var("DSH_RELEASE_VERSION")
        .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_owned());
    if !release_version
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    {
        panic!("DSH_RELEASE_VERSION contains an unsupported runtime directory character");
    }
    println!("cargo:rerun-if-env-changed=DSH_RELEASE_VERSION");
    println!("cargo:rustc-env=DSH_DESKTOP_RUNTIME_DIR=runtime-{release_version}");
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // tauri-build 的资源清单仅链接到产品二进制；原生验证程序也需要 Common Controls v6。
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
