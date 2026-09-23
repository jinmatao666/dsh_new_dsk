use std::{
    fs,
    path::{Path, PathBuf},
};

const MIGRATION_MARKER: &str = ".legacy-dsh-migration-v1";
// Authentication is intentionally fresh for each installer build. Do not
// import the old YAML credential layout just to clear its token immediately.
const USER_FILES: &[&str] = &["settings.yaml", ".anonymous-user-id"];
const USER_DIRECTORIES: &[&str] = &[
    "sessions",
    "storages",
    "attachments",
    "skills",
    ".agent-presets",
];

fn copy_missing(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("无法检查旧版数据 {}：{error}", source.display()))?;
    // Never follow a link out of the legacy home or import a device/special file.
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    // This retired preset shadows the preview's bundled vision tool. Keep it
    // untouched in the old home, but never bring that conflicting copy over.
    if source.ends_with(
        Path::new(".agent-presets")
            .join("vision")
            .join("agent.cordis.yml"),
    ) && fs::read_to_string(source)
        .is_ok_and(|text| text.contains("@linenxi-ctrl/dsh-vision/lib/tool.js"))
    {
        return Ok(());
    }
    if metadata.is_dir() {
        if let Ok(target) = fs::symlink_metadata(destination) {
            if !target.is_dir() || target.file_type().is_symlink() {
                return Err(format!(
                    "新版数据目标不是普通目录：{}",
                    destination.display()
                ));
            }
        }
        fs::create_dir_all(destination)
            .map_err(|error| format!("无法创建新版数据目录 {}：{error}", destination.display()))?;
        for entry in fs::read_dir(source)
            .map_err(|error| format!("无法读取旧版数据目录 {}：{error}", source.display()))?
        {
            let entry = entry.map_err(|error| format!("无法读取旧版数据项：{error}"))?;
            copy_missing(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if metadata.is_file() {
        match fs::symlink_metadata(destination) {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查新版数据目标：{error}")),
        }
        fs::copy(source, destination)
            .map_err(|error| format!("无法复制旧版数据 {}：{error}", source.display()))?;
    }
    Ok(())
}

/// One-way, non-overwriting import. The old client's files are never changed.
pub(crate) fn migrate_legacy_home(new_home: &Path) -> Result<bool, String> {
    let user_home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法定位当前用户目录".to_string())?;
    migrate_from(&PathBuf::from(user_home).join(".dsh"), new_home)
}

fn migrate_from(old_home: &Path, new_home: &Path) -> Result<bool, String> {
    if new_home.join(MIGRATION_MARKER).exists() {
        return Ok(false);
    }
    let metadata = match fs::symlink_metadata(old_home) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("无法检查旧版数据目录：{error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("旧版数据目录不是普通目录，迁移已停止".to_string());
    }
    fs::create_dir_all(new_home).map_err(|error| format!("无法创建新版数据目录：{error}"))?;
    let old_root =
        fs::canonicalize(old_home).map_err(|error| format!("无法定位旧版数据目录：{error}"))?;
    let new_root =
        fs::canonicalize(new_home).map_err(|error| format!("无法定位新版数据目录：{error}"))?;
    if old_root.starts_with(&new_root) || new_root.starts_with(&old_root) {
        return Err("新旧数据目录重叠，迁移已停止".to_string());
    }
    for name in USER_FILES.iter().chain(USER_DIRECTORIES.iter()) {
        let source = old_home.join(name);
        if source.exists() {
            copy_missing(&source, &new_home.join(name))?;
        }
    }
    // The marker is written last. A failed or interrupted copy retries only
    // missing files on the next launch and never replaces preview data.
    fs::write(
        new_home.join(MIGRATION_MARKER),
        b"legacy user data imported without overwrites\n",
    )
    .map_err(|error| format!("无法记录旧版数据迁移状态：{error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::migrate_from;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn migration_copies_user_data_once_without_touching_old_or_existing_preview_data() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "wanwei-home-migration-{}-{nonce}",
            std::process::id()
        ));
        let old = root.join("old");
        let new = root.join("new");
        fs::create_dir_all(old.join("skills/example")).expect("old home");
        fs::create_dir_all(old.join(".agent-presets/vision")).expect("old presets");
        fs::create_dir_all(&new).expect("new home");
        fs::write(old.join(".credentials.yaml"), "old-secret").expect("old credentials");
        fs::write(old.join("skills/example/SKILL.md"), "old skill").expect("old skill");
        fs::write(
            old.join(".agent-presets/vision/agent.cordis.yml"),
            "@linenxi-ctrl/dsh-vision/lib/tool.js",
        )
        .expect("retired preset");
        fs::write(new.join("settings.yaml"), "preview settings").expect("preview settings");
        assert!(migrate_from(&old, &new).expect("migration"));
        assert!(!new.join(".credentials.yaml").exists());
        assert_eq!(
            fs::read_to_string(new.join("skills/example/SKILL.md")).unwrap(),
            "old skill"
        );
        assert_eq!(
            fs::read_to_string(new.join("settings.yaml")).unwrap(),
            "preview settings"
        );
        assert_eq!(
            fs::read_to_string(old.join(".credentials.yaml")).unwrap(),
            "old-secret"
        );
        assert!(!new.join(".agent-presets/vision/agent.cordis.yml").exists());
        assert!(old.join(".agent-presets/vision/agent.cordis.yml").exists());
        assert!(!migrate_from(&old, &new).expect("second launch"));
        fs::remove_dir_all(root).expect("remove test data");
    }

    #[test]
    fn missing_legacy_home_does_nothing() {
        let root = PathBuf::from("nonexistent-legacy-home-for-test");
        assert!(!migrate_from(&root, &root.join("new")).expect("missing home"));
    }
}
