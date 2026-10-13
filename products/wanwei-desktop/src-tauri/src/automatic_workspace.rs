//! Allocate persistent first-send directories without reusing existing user files.
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn create(home: &Path, name: &str) -> Result<PathBuf, String> {
    if name.len() != 12 || !name.bytes().all(|value| value.is_ascii_digit()) {
        return Err("工作区名称必须为年月日时分".to_string());
    }
    let root = home.join("workspaces");
    fs::create_dir_all(&root).map_err(|error| format!("无法创建工作区目录：{error}"))?;
    if fs::symlink_metadata(&root)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("默认工作区目录不能是符号链接".to_string());
    }
    let mut number = 1u64;
    loop {
        let title = if number == 1 {
            name.to_string()
        } else {
            format!("{name} ({number})")
        };
        let path = root.join(title);
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                number = number.checked_add(1).ok_or("工作区名称已用尽")?;
            }
            Err(error) => return Err(format!("无法创建默认工作区：{error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_existing_files_and_allocates_distinct_directories() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::temp_dir().join(format!("wanwei-workspace-{unique}"));
        let first = create(&home, "202610121930").unwrap();
        fs::write(first.join("keep.txt"), "keep").unwrap();
        let second = create(&home, "202610121930").unwrap();
        assert_ne!(first, second);
        assert_eq!(first.file_name().unwrap(), "202610121930");
        assert_eq!(second.file_name().unwrap(), "202610121930 (2)");
        assert_eq!(fs::read_to_string(first.join("keep.txt")).unwrap(), "keep");
        assert!(create(&home, "../escape").is_err());
        fs::remove_dir_all(home).unwrap();
    }
}
