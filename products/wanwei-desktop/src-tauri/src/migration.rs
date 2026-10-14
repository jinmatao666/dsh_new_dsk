use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[cfg(test)]
const MIGRATION_MARKER: &str = ".legacy-dsh-migration-v1";
const FORMAL_MARKER: &str = ".wanwei-formal-migration-v2.json";
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

/// Publish a complete copied file without replacing a concurrently created target.
fn copy_file_missing(source: &Path, destination: &Path) -> Result<(), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = destination.with_file_name(format!(
        ".wanwei-migration-{}-{nonce}.tmp",
        std::process::id()
    ));
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("无法创建迁移临时文件 {}：{error}", temporary.display()))?;
    let result = (|| -> std::io::Result<()> {
        let mut input = fs::File::open(source)?;
        std::io::copy(&mut input, &mut output)?;
        #[cfg(unix)]
        output.set_permissions(input.metadata()?.permissions())?;
        output.sync_all()?;
        // Hard-link publication is same-volume, atomic and never replaces a target.
        match fs::hard_link(&temporary, destination) {
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            result => result,
        }
    })();
    drop(output);
    let _ = fs::remove_file(&temporary);
    result.map_err(|error| format!("无法复制旧版数据 {}：{error}", source.display()))
}

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
        copy_file_missing(source, destination)?;
    }
    Ok(())
}

// The original one-source behavior remains a regression fixture for copy safety.
#[cfg(test)]
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

/// Import both released data homes before the sidecar opens any user storage.
/// Development homes, credentials and executable profile patches are not imported.
pub(crate) fn migrate_desktop_data(app_data: &Path, new_home: &Path) -> Result<bool, String> {
    let user_home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法定位当前用户目录".to_string())?;
    let parent = app_data.parent().ok_or("无法定位应用数据根目录")?;
    let sources = [
        ("current", new_home.to_path_buf()),
        (
            "previous",
            parent.join("com.wanwei.harness.preview").join("dsh-home"),
        ),
        ("legacy", PathBuf::from(user_home).join(".dsh")),
    ];
    migrate_sources(app_data, new_home, &sources)
}

fn ordinary_directory(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("无法检查数据目录 {}：{e}", path.display())),
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(format!("数据目录不是普通目录：{}", path.display())),
    }
}

fn migrate_sources(
    app_data: &Path,
    new_home: &Path,
    sources: &[(&str, PathBuf)],
) -> Result<bool, String> {
    recover_publication(app_data, new_home)?;
    if new_home.join(FORMAL_MARKER).is_file() {
        let report: Value = serde_json::from_slice(
            &fs::read(new_home.join(FORMAL_MARKER)).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("迁移报告损坏：{e}"))?;
        if report["version"] != 2 {
            return Err("迁移报告版本不兼容".into());
        }
        return Ok(false);
    }
    let mut found = Vec::new();
    for (name, path) in sources {
        if ordinary_directory(path)? {
            // Reject nested homes rather than copying the new target into itself.
            let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
            if found.iter().any(|(_, p): &(&str, PathBuf)| {
                canonical.starts_with(p) || p.starts_with(&canonical)
            }) {
                return Err("历史数据目录重叠，迁移已停止".into());
            }
            found.push((*name, canonical));
        }
    }
    if found.is_empty() {
        return Ok(false);
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let recovery = app_data
        .join("migration-backups")
        .join(format!("formal-v2-{nonce}"));
    let stage = recovery.join("staged-home");
    fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let mut conflicts = Vec::new();
    let mut workspace: Option<Value> = None;
    for (name, source) in &found {
        let snapshot = recovery.join(name);
        fs::create_dir_all(&snapshot)
            .map_err(|e| format!("无法创建迁移备份目录 {}：{e}", snapshot.display()))?;
        for entry in USER_FILES.iter().chain(USER_DIRECTORIES.iter()) {
            let path = source.join(entry);
            if path.exists() {
                copy_missing(&path, &snapshot.join(entry))?;
            }
        }
        // The current formal home retains its own runtime/auth state. Historical
        // profiles and credentials are deliberately absent from the snapshots.
        if *name == "current" {
            copy_missing(source, &stage)?;
        }
        for entry in USER_FILES.iter().chain(USER_DIRECTORIES.iter()) {
            let path = snapshot.join(entry);
            if path.exists() {
                merge_files(&path, &stage.join(entry), &stage, &mut conflicts)?;
            }
        }
        let registry = snapshot.join("storages/workspace.json");
        if registry.exists() {
            let value: Value =
                serde_json::from_slice(&fs::read(&registry).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("工作区索引无法读取 {}：{e}", registry.display()))?;
            validate_workspace(&value)?;
            match &mut workspace {
                None => workspace = Some(value),
                Some(current) => merge_workspace(current, value)?,
            }
        }
    }
    if let Some(value) = workspace {
        fs::create_dir_all(stage.join("storages")).map_err(|e| e.to_string())?;
        fs::write(
            stage.join("storages/workspace.json"),
            serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    let report = json!({"version": 2, "sources": found.iter().map(|(name, path)|
        json!({"name": name, "path": path})).collect::<Vec<_>>(),
        "backupDirectory": recovery, "conflicts": conflicts});
    fs::write(
        stage.join(FORMAL_MARKER),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("无法保存迁移报告：{e}"))?;
    // Publish only a fully copied home. Interrupted staging never becomes active.
    let previous = recovery.join("previous-formal-home");
    let existed = ordinary_directory(new_home)?;
    fs::write(
        app_data.join(".formal-migration-pending"),
        format!("formal-v2-{nonce}"),
    )
    .map_err(|e| format!("无法记录迁移发布状态：{e}"))?;
    if existed {
        fs::rename(new_home, &previous).map_err(|e| format!("无法保留原数据目录：{e}"))?;
    }
    if let Err(e) = fs::rename(&stage, new_home) {
        if existed {
            fs::rename(&previous, new_home).map_err(|restore| {
                format!(
                    "迁移发布失败：{e}；恢复失败：{restore}。原数据保留在 {}",
                    previous.display()
                )
            })?;
        }
        return Err(format!("迁移发布失败，旧数据未删除：{e}"));
    }
    fs::remove_file(app_data.join(".formal-migration-pending")).map_err(|e| e.to_string())?;
    Ok(true)
}

fn recover_publication(app_data: &Path, new_home: &Path) -> Result<(), String> {
    let pending = app_data.join(".formal-migration-pending");
    let name = match fs::read_to_string(&pending) {
        Ok(name) => name,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    if !name
        .strip_prefix("formal-v2-")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("迁移发布状态损坏，原数据保留".into());
    }
    let root = app_data.join("migration-backups").join(name);
    if !ordinary_directory(new_home)? {
        let stage = root.join("staged-home");
        let original = root.join("previous-formal-home");
        if ordinary_directory(&stage)? && stage.join(FORMAL_MARKER).is_file() {
            fs::rename(stage, new_home).map_err(|e| e.to_string())?;
        } else if ordinary_directory(&original)? {
            fs::rename(original, new_home).map_err(|e| e.to_string())?;
        } else {
            return Err(format!("迁移发布未完成，请检查恢复目录 {}", root.display()));
        }
    }
    fs::remove_file(pending).map_err(|e| e.to_string())
}

// Equal logs deduplicate. A byte-prefix log is an append-only continuation;
// divergent logs stay in the recovery snapshot, never splice their events.
fn file_relation(source: &Path, target: &Path) -> Result<(bool, bool), String> {
    let mut a = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut b = fs::File::open(target).map_err(|e| e.to_string())?;
    let a_len = a.metadata().map_err(|e| e.to_string())?.len();
    let b_len = b.metadata().map_err(|e| e.to_string())?.len();
    let mut remaining = a_len.min(b_len);
    let (mut left, mut right) = ([0u8; 65536], [0u8; 65536]);
    while remaining > 0 {
        let count = remaining.min(left.len() as u64) as usize;
        a.read_exact(&mut left[..count])
            .map_err(|e| e.to_string())?;
        b.read_exact(&mut right[..count])
            .map_err(|e| e.to_string())?;
        if left[..count] != right[..count] {
            return Ok((false, false));
        }
        remaining -= count as u64;
    }
    Ok((a_len == b_len, a_len > b_len))
}

fn merge_files(
    source: &Path,
    target: &Path,
    root: &Path,
    conflicts: &mut Vec<String>,
) -> Result<(), String> {
    let meta = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if let Some(name) = target.file_name().and_then(|s| s.to_str()) {
        let alternate = match name {
            "session.jsonl" => Some("session.jsonl.zstd"),
            "session.jsonl.zstd" => Some("session.jsonl"),
            _ => None,
        };
        if alternate.is_some_and(|other| target.with_file_name(other).exists()) {
            conflicts.push(
                target
                    .strip_prefix(root)
                    .unwrap_or(target)
                    .display()
                    .to_string(),
            );
            return Ok(());
        }
    }
    if !target.exists() {
        return copy_missing(source, target);
    }
    let target_meta = fs::symlink_metadata(target).map_err(|e| e.to_string())?;
    if target_meta.file_type().is_symlink() {
        return Err("迁移目标包含链接，迁移已停止".into());
    }
    if meta.is_dir() && target_meta.is_dir() {
        // An installed skill is one unit: do not combine two versions' scripts/keys.
        if source.join("SKILL.md").is_file() {
            if !directories_equal(source, target)? {
                conflicts.push(
                    target
                        .strip_prefix(root)
                        .unwrap_or(target)
                        .display()
                        .to_string(),
                );
            }
            return Ok(());
        }
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            merge_files(
                &entry.path(),
                &target.join(entry.file_name()),
                root,
                conflicts,
            )?;
        }
    } else if meta.is_file() && target_meta.is_file() {
        let (equal, extends) = file_relation(source, target)?;
        if equal {
            return Ok(());
        }
        let relative = target.strip_prefix(root).map_err(|e| e.to_string())?;
        if relative.starts_with("sessions") && extends {
            // Only the disposable staged copy is replaced; originals are untouched.
            fs::copy(source, target).map_err(|e| e.to_string())?;
        } else if relative != Path::new("storages/workspace.json") {
            conflicts.push(relative.display().to_string());
        }
    } else {
        conflicts.push(
            target
                .strip_prefix(root)
                .unwrap_or(target)
                .display()
                .to_string(),
        );
    }
    Ok(())
}

fn directories_equal(a: &Path, b: &Path) -> Result<bool, String> {
    let names = |p: &Path| -> Result<Vec<std::ffi::OsString>, String> {
        let mut result = fs::read_dir(p)
            .map_err(|e| e.to_string())?
            .map(|e| e.map(|e| e.file_name()).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        result.sort();
        Ok(result)
    };
    let left = names(a)?;
    if left != names(b)? {
        return Ok(false);
    }
    for name in left {
        let (x, y) = (a.join(&name), b.join(&name));
        let xm = fs::symlink_metadata(&x).map_err(|e| e.to_string())?;
        let ym = fs::symlink_metadata(&y).map_err(|e| e.to_string())?;
        if xm.file_type().is_symlink() || ym.file_type().is_symlink() {
            return Ok(false);
        }
        if xm.is_dir() && ym.is_dir() {
            if !directories_equal(&x, &y)? {
                return Ok(false);
            }
        } else if xm.is_file() && ym.is_file() {
            if !file_relation(&x, &y)?.0 {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
    }
    Ok(true)
}

fn validate_workspace(value: &Value) -> Result<(), String> {
    if value["unit"]["name"] != "workspace"
        || value["unit"]["version"] != 2
        || !value["tables"]["workspaces"].is_object()
        || !value["global"]["workspaceIds"].is_array()
        || !value["global"]["initialized"].is_boolean()
        || value["global"].get("pendingMutation").is_some()
    {
        return Err("工作区索引格式不兼容，原数据保留，迁移已停止".into());
    }
    for row in value["tables"]["workspaces"].as_object().unwrap().values() {
        if !row["path"].is_string()
            || !row["title"].is_string()
            || !row["createdAt"].is_string()
            || !row["updatedAt"].is_string()
            || !row["sessionIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().all(Value::is_string))
        {
            return Err("工作区索引内容不完整，迁移已停止".into());
        }
    }
    let rows = value["tables"]["workspaces"].as_object().unwrap();
    if value["global"]["workspaceIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| !id.as_str().is_some_and(|id| rows.contains_key(id)))
    {
        return Err("工作区索引引用了不存在的记录，迁移已停止".into());
    }
    Ok(())
}

fn path_key(value: &Value) -> String {
    let path = value
        .as_str()
        .unwrap_or_default()
        .trim_end_matches(['/', '\\']);
    if cfg!(windows) {
        path.replace('\\', "/").to_lowercase()
    } else {
        path.to_string()
    }
}

fn union_ids(current: &mut Value, incoming: &Value) -> Result<(), String> {
    let list = current.as_array_mut().ok_or("工作区 ID 列表格式错误")?;
    for id in incoming.as_array().ok_or("历史工作区 ID 列表格式错误")? {
        if !id.is_string() {
            return Err("工作区 ID 不是字符串".into());
        }
        if !list.contains(id) {
            list.push(id.clone());
        }
    }
    Ok(())
}

fn merge_workspace(current: &mut Value, incoming: Value) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let mut owned: std::collections::HashSet<String> = current["tables"]["workspaces"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|row| row["sessionIds"].as_array().unwrap().iter())
        .filter_map(|id| id.as_str().map(str::to_string))
        .collect();
    let originally_owned = owned.clone();
    let rows = incoming["tables"]["workspaces"].as_object().unwrap();
    for id in incoming["global"]["workspaceIds"].as_array().unwrap() {
        let id = id.as_str().ok_or("工作区 ID 不是字符串")?;
        let mut row = rows.get(id).ok_or("工作区索引引用了不存在的记录")?.clone();
        row["sessionIds"]
            .as_array_mut()
            .unwrap()
            .retain(|id| owned.insert(id.as_str().unwrap().to_string()));
        let target_rows = current["tables"]["workspaces"].as_object_mut().unwrap();
        let matching = target_rows
            .iter()
            .find(|(_, existing)| path_key(&existing["path"]) == path_key(&row["path"]))
            .map(|(key, _)| key.clone());
        let key = if let Some(key) = matching {
            union_ids(
                &mut target_rows.get_mut(&key).unwrap()["sessionIds"],
                &row["sessionIds"],
            )?;
            key
        } else {
            let mut key = id.to_string();
            if target_rows.contains_key(id) {
                let hash = format!("{:x}", Sha256::digest(path_key(&row["path"]).as_bytes()));
                key = format!(
                    "{}-{}-5{}-a{}-{}",
                    &hash[..8],
                    &hash[8..12],
                    &hash[13..16],
                    &hash[17..20],
                    &hash[20..32]
                );
                if target_rows.contains_key(&key) {
                    return Err("工作区迁移 ID 冲突，原数据保留".into());
                }
            }
            target_rows.insert(key.clone(), row.clone());
            key
        };
        union_ids(&mut current["global"]["workspaceIds"], &json!([key]))?;
    }
    if current["global"]["archivedSessionIds"].is_null() {
        current["global"]["archivedSessionIds"] = json!([]);
    }
    if let Some(ids) = incoming["global"]["archivedSessionIds"].as_array() {
        let archived = json!(ids
            .iter()
            .filter(|id| id.as_str().is_some_and(|id| !originally_owned.contains(id)))
            .collect::<Vec<_>>());
        union_ids(&mut current["global"]["archivedSessionIds"], &archived)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        copy_file_missing, merge_workspace, migrate_from, migrate_sources, recover_publication,
        FORMAL_MARKER,
    };
    use serde_json::{json, Value};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn file_publication_preserves_existing_data_and_cleans_failed_copies() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "wanwei-migration-publish-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("旧数据 中文.txt");
        let target = root.join("新数据 中文.txt");
        fs::write(&source, b"legacy data").unwrap();
        fs::write(&target, b"newer data").unwrap();
        copy_file_missing(&source, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"newer data");
        let fresh = root.join("fresh.txt");
        copy_file_missing(&source, &fresh).unwrap();
        assert_eq!(fs::read(&fresh).unwrap(), b"legacy data");
        let failed = root.join("failed.txt");
        assert!(copy_file_missing(&root.join("missing.txt"), &failed).is_err());
        assert!(!failed.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
        fs::remove_dir_all(root).unwrap();
    }

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

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "wanwei-formal-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn migration_snapshots_root_files_before_any_user_directories_exist() {
        for source_name in ["current", "previous", "legacy"] {
            let root = test_root(source_name);
            let app = root.join("app");
            let new = app.join("dsh-home");
            let source = if source_name == "current" {
                new.clone()
            } else {
                root.join(source_name)
            };
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("settings.yaml"), b"user settings").unwrap();
            fs::write(source.join(".anonymous-user-id"), b"existing identity").unwrap();
            let sources = [(source_name, source.clone())];
            assert!(migrate_sources(&app, &new, &sources).unwrap());
            let report: Value =
                serde_json::from_slice(&fs::read(new.join(FORMAL_MARKER)).unwrap()).unwrap();
            let snapshot =
                PathBuf::from(report["backupDirectory"].as_str().unwrap()).join(source_name);
            for (name, content) in [
                ("settings.yaml", b"user settings".as_slice()),
                (".anonymous-user-id", b"existing identity".as_slice()),
            ] {
                assert_eq!(fs::read(new.join(name)).unwrap(), content);
                assert_eq!(fs::read(snapshot.join(name)).unwrap(), content);
                assert_eq!(fs::read(source.join(name)).unwrap(), content);
            }
            assert!(!migrate_sources(&app, &new, &sources).unwrap());
            fs::remove_dir_all(root).unwrap();
        }
    }

    fn registry(id: &str, path: &str, sessions: &[&str]) -> Value {
        json!({"unit":{"name":"workspace","version":2},
            "global":{"initialized":true,"workspaceIds":[id],"archivedSessionIds":[]},
            "tables":{"workspaces":{id:{"path":path,"title":"项目","sessionIds":sessions,"createdAt":"2026-10-10T00:00:00Z","updatedAt":"2026-10-10T00:00:00Z"}}}})
    }

    #[test]
    fn merges_both_release_homes_and_keeps_originals_and_conflicting_skills() {
        let root = test_root("both");
        let app = root.join("app");
        let new = app.join("dsh-home");
        let old = root.join("legacy");
        let recent = root.join("previous");
        for home in [&old, &recent] {
            fs::create_dir_all(home.join("sessions/project/shared")).unwrap();
            fs::create_dir_all(home.join("skills/example")).unwrap();
            fs::create_dir_all(home.join("storages")).unwrap();
            fs::write(home.join(".credentials.yaml"), "secret-do-not-import").unwrap();
        }
        fs::write(
            old.join("sessions/project/shared/session.jsonl"),
            "header\nold\n",
        )
        .unwrap();
        fs::write(
            recent.join("sessions/project/shared/session.jsonl"),
            "header\nold\nnew\n",
        )
        .unwrap();
        fs::write(old.join("skills/example/SKILL.md"), "old").unwrap();
        fs::write(old.join("skills/example/old-only.py"), "old script").unwrap();
        fs::write(recent.join("skills/example/SKILL.md"), "new").unwrap();
        fs::write(
            old.join("storages/workspace.json"),
            registry("old-id", "/same/project", &["shared", "old-only"]).to_string(),
        )
        .unwrap();
        fs::write(
            recent.join("storages/workspace.json"),
            registry("new-id", "/same/project", &["shared", "new-only"]).to_string(),
        )
        .unwrap();
        let sources = [
            ("current", new.clone()),
            ("previous", recent.clone()),
            ("legacy", old.clone()),
        ];
        assert!(migrate_sources(&app, &new, &sources).unwrap());
        assert!(!new.join(".credentials.yaml").exists());
        assert_eq!(
            fs::read_to_string(new.join("skills/example/SKILL.md")).unwrap(),
            "new"
        );
        assert!(!new.join("skills/example/old-only.py").exists());
        let state: Value =
            serde_json::from_slice(&fs::read(new.join("storages/workspace.json")).unwrap())
                .unwrap();
        assert_eq!(state["global"]["workspaceIds"], json!(["new-id"]));
        assert_eq!(
            state["tables"]["workspaces"]["new-id"]["sessionIds"],
            json!(["shared", "new-only", "old-only"])
        );
        let report: Value =
            serde_json::from_slice(&fs::read(new.join(FORMAL_MARKER)).unwrap()).unwrap();
        let recovery = PathBuf::from(report["backupDirectory"].as_str().unwrap());
        assert_eq!(
            fs::read_to_string(recovery.join("legacy/skills/example/old-only.py")).unwrap(),
            "old script"
        );
        assert_eq!(
            fs::read_to_string(old.join("sessions/project/shared/session.jsonl")).unwrap(),
            "header\nold\n"
        );
        assert!(!migrate_sources(&app, &new, &sources).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn longer_append_only_log_wins_but_divergent_logs_are_not_spliced() {
        let root = test_root("conflict");
        let app = root.join("app");
        let new = app.join("dsh-home");
        let source = root.join("source");
        for home in [&new, &source] {
            fs::create_dir_all(home.join("sessions/project/continued")).unwrap();
            fs::create_dir_all(home.join("sessions/project/diverged")).unwrap();
        }
        fs::write(
            new.join("sessions/project/continued/session.jsonl.zstd"),
            b"prefix",
        )
        .unwrap();
        fs::write(
            source.join("sessions/project/continued/session.jsonl.zstd"),
            b"prefix-longer",
        )
        .unwrap();
        fs::write(
            new.join("sessions/project/diverged/session.jsonl"),
            b"branch-a",
        )
        .unwrap();
        fs::write(
            source.join("sessions/project/diverged/session.jsonl"),
            b"branch-b",
        )
        .unwrap();
        let sources = [("current", new.clone()), ("legacy", source.clone())];
        assert!(migrate_sources(&app, &new, &sources).unwrap());
        assert_eq!(
            fs::read(new.join("sessions/project/continued/session.jsonl.zstd")).unwrap(),
            b"prefix-longer"
        );
        assert_eq!(
            fs::read(new.join("sessions/project/diverged/session.jsonl")).unwrap(),
            b"branch-a"
        );
        let report: Value =
            serde_json::from_slice(&fs::read(new.join(FORMAL_MARKER)).unwrap()).unwrap();
        assert!(report["conflicts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("diverged")));
        let recovery = PathBuf::from(report["backupDirectory"].as_str().unwrap());
        assert_eq!(
            fs::read(recovery.join("legacy/sessions/project/diverged/session.jsonl")).unwrap(),
            b"branch-b"
        );
        assert!(recovery.join("previous-formal-home").is_dir());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn either_source_can_upgrade_without_the_other() {
        for source_name in ["legacy", "previous"] {
            let root = test_root(source_name);
            let app = root.join("app");
            let new = app.join("dsh-home");
            let old = root.join(source_name);
            fs::create_dir_all(old.join("attachments")).unwrap();
            fs::write(old.join("attachments/file.docx"), b"document").unwrap();
            assert!(migrate_sources(&app, &new, &[(source_name, old)]).unwrap());
            assert_eq!(
                fs::read(new.join("attachments/file.docx")).unwrap(),
                b"document"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn invalid_registry_never_replaces_the_formal_home() {
        let root = test_root("invalid");
        let app = root.join("app");
        let new = app.join("dsh-home");
        let old = root.join("old");
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.yaml"), b"existing").unwrap();
        fs::create_dir_all(old.join("storages")).unwrap();
        fs::write(old.join("storages/workspace.json"), b"{}").unwrap();
        assert!(migrate_sources(&app, &new, &[("current", new.clone()), ("legacy", old)]).is_err());
        assert_eq!(fs::read(new.join("settings.yaml")).unwrap(), b"existing");
        assert!(!new.join(FORMAL_MARKER).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn same_workspace_id_at_different_paths_is_preserved_separately() {
        let mut current = registry("same-id", "/one", &["one"]);
        merge_workspace(&mut current, registry("same-id", "/two", &["two"])).unwrap();
        assert_eq!(
            current["global"]["workspaceIds"].as_array().unwrap().len(),
            2
        );
        assert_eq!(
            current["tables"]["workspaces"].as_object().unwrap().len(),
            2
        );
    }

    #[test]
    fn reinstall_keeps_skills_and_sessions_added_after_migration() {
        let root = test_root("reinstall-data");
        let app = root.join("app");
        let new = app.join("dsh-home");
        let old = root.join("legacy");
        fs::create_dir_all(old.join("skills/old")).unwrap();
        fs::write(old.join("skills/old/SKILL.md"), "old skill").unwrap();
        let sources = [("current", new.clone()), ("legacy", old.clone())];
        assert!(migrate_sources(&app, &new, &sources).unwrap());
        fs::create_dir_all(new.join("skills/recent")).unwrap();
        fs::create_dir_all(new.join("sessions/recent")).unwrap();
        fs::write(new.join("skills/recent/SKILL.md"), "recent skill").unwrap();
        fs::write(new.join("sessions/recent/session.jsonl"), "recent session").unwrap();
        fs::write(new.join("settings.yaml"), "recent settings").unwrap();
        let marker = fs::read(new.join(FORMAL_MARKER)).unwrap();
        for _ in 0..3 {
            assert!(!migrate_sources(&app, &new, &sources).unwrap());
            assert_eq!(fs::read(new.join(FORMAL_MARKER)).unwrap(), marker);
            assert_eq!(
                fs::read_to_string(new.join("skills/recent/SKILL.md")).unwrap(),
                "recent skill"
            );
            assert_eq!(
                fs::read_to_string(new.join("sessions/recent/session.jsonl")).unwrap(),
                "recent session"
            );
            assert_eq!(
                fs::read_to_string(new.join("settings.yaml")).unwrap(),
                "recent settings"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_publication_resumes_the_completed_stage() {
        let root = test_root("resume");
        let recovery = root.join("migration-backups/formal-v2-123");
        let stage = recovery.join("staged-home");
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join(FORMAL_MARKER), b"{\"version\":2}").unwrap();
        fs::write(stage.join("settings.yaml"), b"complete").unwrap();
        fs::write(root.join(".formal-migration-pending"), b"formal-v2-123").unwrap();
        let new = root.join("dsh-home");
        recover_publication(&root, &new).unwrap();
        assert_eq!(fs::read(new.join("settings.yaml")).unwrap(), b"complete");
        assert!(!root.join(".formal-migration-pending").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
