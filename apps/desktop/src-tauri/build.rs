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
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "set_auth_window_state",
            "save_session_log_archive",
            "list_marketplace_skills",
            "install_marketplace_skill",
            "uninstall_marketplace_skill",
            "install_custom_skill",
            "install_custom_skill_directory",
            "uninstall_custom_skill",
            "list_custom_skills",
            "read_analysis_view",
        ]),
    ))
    .expect("failed to generate desktop command permissions");
}
