//! SkillHub installations have their own receipt and never replace another skill source.
use super::*;

const RECEIPT: &str = ".wanwei-skillhub.json";
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub source: String,
    pub slug: String,
    pub local_slug: String,
    pub version: String,
    pub name: String,
    pub summary: String,
    pub sha256: String,
}

fn safe_root(root: &Path) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(root) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("技能根目录必须为普通目录".into());
        }
    }
    Ok(())
}

fn receipt_at(directory: &Path) -> Result<InstalledSkill, String> {
    let meta = fs::symlink_metadata(directory).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("拒绝操作链接技能目录".into());
    }
    let receipt_path = directory.join(RECEIPT);
    let meta = fs::symlink_metadata(&receipt_path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 65536 {
        return Err("SkillHub 安装记录无效".into());
    }
    let value: InstalledSkill =
        serde_json::from_slice(&fs::read(receipt_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    validate_marketplace_slug(&value.local_slug)?;
    if value.source != "skillhub"
        || directory.file_name().and_then(|v| v.to_str()) != Some(&value.local_slug)
    {
        return Err("SkillHub 安装记录与目录不一致".into());
    }
    Ok(value)
}

fn install_at(
    root: &Path,
    archive: Vec<u8>,
    mut record: InstalledSkill,
) -> Result<InstalledSkill, String> {
    let _guard = INSTALL_LOCK.lock().map_err(|e| e.to_string())?;
    safe_root(root)?;
    if record.slug.is_empty()
        || record.slug.len() > 128
        || !record.slug.as_bytes()[0].is_ascii_alphanumeric()
        || !record
            .slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err("SkillHub 技能标识无效".into());
    }
    if record.version.is_empty()
        || record.version.len() > 128
        || record.name.len() > 1024
        || record.summary.len() > 16384
    {
        return Err("SkillHub 安装信息无效".into());
    }
    if archive.len() > 16 * 1024 * 1024
        || format!("{:x}", Sha256::digest(&archive)) != record.sha256
    {
        return Err("SkillHub 下载包摘要不匹配".into());
    }
    // Reject package-authored receipts before the shared archive importer creates its marker.
    let mut zip = zip::ZipArchive::new(Cursor::new(&archive)).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry
            .name()
            .split(['/', '\\'])
            .any(|part| part.starts_with(".dsh") || part == RECEIPT)
        {
            return Err("技能包不能包含本地安装管理文件".into());
        }
    }
    drop(zip);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let workspace =
        skill_staging_root(root)?.join(format!("skillhub-{}-{nonce}", std::process::id()));
    let temporary_root = workspace.join("skills");
    let result = (|| {
        let imported = install_custom_skill_archive_at(&temporary_root, archive)?;
        record.source = "skillhub".into();
        record.local_slug = imported.slug;
        let target = root.join(&record.local_slug);
        if fs::symlink_metadata(&target).is_ok() {
            return Err(format!(
                "本地已有同名技能 {}，未覆盖，请先处理冲突",
                record.local_slug
            ));
        }
        let source = temporary_root.join(&record.local_slug);
        fs::remove_file(source.join(".dsh-custom-skill")).map_err(|e| e.to_string())?;
        fs::write(
            source.join(RECEIPT),
            serde_json::to_vec(&record).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        fs::rename(source, &target).map_err(|e| format!("安装失败，原有技能未改变：{e}"))?;
        Ok(record)
    })();
    if workspace.is_dir() {
        let _ = fs::remove_dir_all(workspace);
    }
    result
}

fn list_at(root: &Path) -> Result<Vec<InstalledSkill>, String> {
    safe_root(root)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.join(RECEIPT).exists() {
            items.push(receipt_at(&path)?);
        }
    }
    items.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(items)
}

fn uninstall_at(root: &Path, slug: &str, local_slug: &str) -> Result<(), String> {
    let _guard = INSTALL_LOCK.lock().map_err(|e| e.to_string())?;
    safe_root(root)?;
    validate_marketplace_slug(local_slug)?;
    let directory = root.join(local_slug);
    let installed = receipt_at(&directory)?;
    if installed.slug != slug {
        return Err("技能来源不匹配，拒绝卸载".into());
    }
    fs::remove_dir_all(directory).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_skillhub_skill(
    app: tauri::AppHandle,
    archive: String,
    record: InstalledSkill,
) -> Result<InstalledSkill, String> {
    if archive.len() > 24 * 1024 * 1024 {
        return Err("SkillHub 下载包过大".into());
    }
    let root = user_skills_root(&app)?;
    let value = tauri::async_runtime::spawn_blocking(move || {
        install_at(
            &root,
            BASE64_STANDARD.decode(archive).map_err(|e| e.to_string())?,
            record,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(value)
}

#[tauri::command]
pub fn list_skillhub_skills(app: tauri::AppHandle) -> Result<Vec<InstalledSkill>, String> {
    list_at(&user_skills_root(&app)?)
}

#[tauri::command]
pub fn uninstall_skillhub_skill(
    app: tauri::AppHandle,
    slug: String,
    local_slug: String,
) -> Result<(), String> {
    uninstall_at(&user_skills_root(&app)?, &slug, &local_slug)?;
    wait_for_skill_catalog_observation();
    notify_skill_catalog_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestRoot(PathBuf);
    impl TestRoot {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self(std::env::temp_dir().join(format!(
                "wanwei-skillhub-test-{}-{nonce}",
                std::process::id()
            )))
        }
    }
    impl Drop for TestRoot {
        fn drop(&mut self) {
            if self.0.exists() {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }
    fn archive(files: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, content) in files {
            writer
                .start_file(*path, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn record(bytes: &[u8]) -> InstalledSkill {
        InstalledSkill {
            source: "skillhub".into(),
            slug: "remote-skill".into(),
            local_slug: String::new(),
            version: "1.0".into(),
            name: "Test skill".into(),
            summary: "Test".into(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
        }
    }
    #[test]
    fn install_discover_and_uninstall_preserve_source_and_local_name() {
        let root = TestRoot::new();
        let skills = root.0.join("skills");
        let bytes = archive(&[
            (
                "SKILL.md",
                "---\nname: local-skill\ndescription: test\n---\nUse this skill.",
            ),
            ("references/help.md", "reference"),
        ]);
        let installed = install_at(&skills, bytes.clone(), record(&bytes)).unwrap();
        assert_eq!(installed.local_slug, "local-skill");
        assert_eq!(list_at(&skills).unwrap().len(), 1);
        assert!(!skills.join("local-skill/.dsh-custom-skill").exists());
        assert!(
            super::super::installed_manifest(&skills.join("local-skill"), "local-skill").is_err()
        );
        assert!(uninstall_at(&skills, "different-source", "local-skill").is_err());
        assert!(skills.join("local-skill/SKILL.md").is_file());
        uninstall_at(&skills, "remote-skill", "local-skill").unwrap();
        assert!(list_at(&skills).unwrap().is_empty());
    }
    #[test]
    fn rejects_conflicts_without_changing_existing_files() {
        let root = TestRoot::new();
        let skills = root.0.join("skills");
        fs::create_dir_all(skills.join("local-skill")).unwrap();
        fs::write(skills.join("local-skill/SKILL.md"), "original").unwrap();
        let bytes = archive(&[("SKILL.md", "---\nname: local-skill\ndescription: test\n---")]);
        assert!(install_at(&skills, bytes.clone(), record(&bytes))
            .unwrap_err()
            .contains("同名"));
        assert_eq!(
            fs::read_to_string(skills.join("local-skill/SKILL.md")).unwrap(),
            "original"
        );
    }
    #[test]
    fn rejects_traversal_receipts_and_corrupted_downloads() {
        let root = TestRoot::new();
        let skills = root.0.join("skills");
        for extra in ["../outside", ".wanwei-skillhub.json", ".dsh-custom-skill"] {
            let bytes = archive(&[
                ("SKILL.md", "---\nname: local-skill\ndescription: test\n---"),
                (extra, "bad"),
            ]);
            assert!(install_at(&skills, bytes.clone(), record(&bytes)).is_err());
        }
        let bytes = archive(&[("SKILL.md", "---\nname: local-skill\ndescription: test\n---")]);
        let mut metadata = record(&bytes);
        metadata.sha256 = "wrong".into();
        assert!(install_at(&skills, bytes, metadata).is_err());
        assert!(!skills.join("local-skill").exists());
    }
    #[test]
    #[ignore = "requires an explicitly downloaded public SkillHub archive"]
    fn live_archive_installs_in_isolated_root() {
        let source = std::env::var("WANWEI_SKILLHUB_TEST_ARCHIVE").expect("archive path");
        let bytes = fs::read(source).unwrap();
        let root = TestRoot::new();
        let skills = root.0.join("skills");
        let installed = install_at(&skills, bytes.clone(), record(&bytes)).unwrap();
        assert!(skills
            .join(&installed.local_slug)
            .join("SKILL.md")
            .is_file());
        assert_eq!(
            list_at(&skills).unwrap()[0].local_slug,
            installed.local_slug
        );
        uninstall_at(&skills, &installed.slug, &installed.local_slug).unwrap();
    }
}
