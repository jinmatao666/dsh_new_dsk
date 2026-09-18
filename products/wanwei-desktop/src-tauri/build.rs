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
    tauri_build::build()
}
