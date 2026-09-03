fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "set_auth_window_state",
                "save_session_log_archive",
                "list_marketplace_skills",
                "install_marketplace_skill",
                "uninstall_marketplace_skill",
            ]),
        ),
    )
    .expect("failed to generate desktop command permissions");
}
