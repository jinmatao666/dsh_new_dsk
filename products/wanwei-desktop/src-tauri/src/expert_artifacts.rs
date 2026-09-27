//! Save expert-owned output bytes without trusting a remote site's local path.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(crate) const MAX_BYTES: usize = 128 * 1024 * 1024;

pub(crate) fn save_at(root: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let path = Path::new(name);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name.len() > 180
        || stem.is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|character| character.is_control() || "/\\:<>|\"?*".contains(character))
        || matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && matches!(device.as_bytes()[3], b'1'..=b'9'))
        || ![
            "pdf", "docx", "xlsx", "png", "jpg", "jpeg", "webp", "zip", "json", "geojson", "md",
            "txt", "csv", "html",
        ]
        .contains(&extension.as_str())
    {
        return Err("成果文件名或类型无效".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("成果文件为空或超过 128 MB".into());
    }
    fs::create_dir_all(root).map_err(|_| "无法创建成果下载目录")?;
    for index in 0..10_000 {
        let filename = if index == 0 {
            name.to_owned()
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let destination = root.join(filename);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(mut file) => {
                if file.write_all(bytes).is_err() {
                    drop(file);
                    // This invocation exclusively created the partial file.
                    let _ = fs::remove_file(&destination);
                    return Err("成果文件写入失败".into());
                }
                return Ok(destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("无法创建成果文件".into()),
        }
    }
    Err("同名成果文件过多".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_chinese_names_and_never_overwrites_an_existing_file() {
        let temporary = std::env::temp_dir();
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = temporary.join(format!("wanwei-expert-save-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let first = save_at(&root, "成果报告.pdf", b"first").unwrap();
        let second = save_at(&root, "成果报告.pdf", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(first).unwrap(), b"first");
        assert_eq!(fs::read(second).unwrap(), b"second");
        assert_eq!(root.parent(), Some(temporary.as_path()));
        // Only the exclusively created test directory is removed.
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_paths_devices_executables_and_empty_bytes() {
        for name in [
            "../x.pdf",
            "x\\y.pdf",
            "CON.pdf",
            "LPT1.txt",
            "run.exe",
            "x.pdf.",
            ".hidden.pdf",
            "x:stream.pdf",
        ] {
            assert!(save_at(Path::new("unused"), name, b"data").is_err());
        }
        assert!(save_at(Path::new("unused"), "报告.pdf", b"").is_err());
    }
}
