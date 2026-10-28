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
    println!("cargo:rerun-if-env-changed=DSH_RELEASE_OFFICIAL");
    let official = std::env::var("DSH_RELEASE_OFFICIAL").unwrap_or_else(|_| "false".into());
    if official != "true" && official != "false" {
        panic!("DSH_RELEASE_OFFICIAL must be true or false");
    }
    println!("cargo:rustc-env=DSH_RELEASE_OFFICIAL={official}");
    for name in ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-changed=src");
    let build_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock precedes Unix epoch")
        .as_nanos();
    // 同版本重建也拥有独立身份，重启后才能确认真正运行了新的安装包。
    println!("cargo:rustc-env=DSH_DESKTOP_BUILD_ID={build_id}");
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo OUT_DIR"));
    let profile_dir = out.ancestors().nth(3).expect("Cargo profile directory");
    std::fs::write(
        profile_dir.join("desktop-build-id.txt"),
        build_id.to_string(),
    )
    .expect("write desktop update build identity");
    println!("cargo:rustc-env=DSH_DESKTOP_RUNTIME_DIR=runtime-{release_version}");
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // tauri-build 的资源清单仅链接到产品二进制；原生验证程序也需要 Common Controls v6。
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
