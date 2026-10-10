//! Installed display names are shared by all skill sources, independent of UI plugins.
use super::*;

pub(super) static INSTALL_LOCK: Mutex<()> = Mutex::new(());
const RECORD: &str = ".dsh-skill-display.json";

pub(super) fn display_name(directory: &Path) -> Result<String, String> {
    for (file, key) in [
        (RECORD, "displayName"),
        (".wanwei-skillhub.json", "name"),
        ("manifest.json", "displayName"),
    ] {
        let path = directory.join(file);
        if path.exists() {
            let value: serde_json::Value =
                serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if file == "manifest.json"
                && value[key]
                    .as_str()
                    .map_or(true, |name| name.trim().is_empty())
            {
                continue;
            }
            return value[key]
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .map(|name| name.trim().to_string())
                .ok_or_else(|| "技能显示名称无效".into());
        }
    }
    let text = fs::read_to_string(directory.join("SKILL.md")).map_err(|e| e.to_string())?;
    Ok(from_text(&text))
}

pub(super) fn from_text(text: &str) -> String {
    if let Some(name) = custom_skill_front_matter_value(text, "display-name") {
        return name.trim().to_string();
    }
    custom_skill_front_matter_value(text, "name").unwrap_or_default()
}

fn normalized(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(super) fn ensure_available(
    root: &Path,
    target: &Path,
    name: &str,
    updating: bool,
) -> Result<(), String> {
    if name.trim().is_empty() || name.len() > 1024 || name.contains(['\n', '\r', '/']) {
        return Err("技能名称不能为空，不能包含换行或斜杠".into());
    }
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if updating && path == target {
            continue;
        }
        if entry.file_type().map_err(|e| e.to_string())?.is_symlink() {
            return Err("技能目录含符号链接，无法安全校验名称".into());
        }
        if !path.join("SKILL.md").is_file() {
            continue;
        }
        if normalized(&display_name(&path)?) == normalized(name) {
            return Err(format!(
                "已存在同名技能“{}”，请修改名称后再添加",
                name.trim()
            ));
        }
    }
    Ok(())
}

pub(super) fn persist(directory: &Path, name: &str) -> Result<(), String> {
    fs::write(
        directory.join(RECORD),
        serde_json::to_vec(&serde_json::json!({"displayName": name.trim()}))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_equal_display_names_across_ids_and_sources_but_allows_updates() {
        let root = std::env::temp_dir().join(format!(
            "wanwei-skill-names-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let old = root.join("platform-meeting");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("SKILL.md"), "---\nname: platform-meeting\n---\n").unwrap();
        persist(&old, "会议纪要").unwrap();
        let other = root.join("personal-meeting");
        assert!(ensure_available(&root, &other, " 会议纪要 ", false)
            .unwrap_err()
            .contains("已存在同名技能"));
        assert!(ensure_available(&root, &old, "会议纪要", true).is_ok());
        persist(&old, "Meeting Notes").unwrap();
        assert!(ensure_available(&root, &other, " meeting  NOTES ", false).is_err());
        assert!(ensure_available(&root, &other, "项目例会纪要", false).is_ok());
        fs::remove_dir_all(&root).unwrap();
    }
}
