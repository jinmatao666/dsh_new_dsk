//! Read explicit OS file-list clipboard content, never interpret plain text as file access.
use clipboard_rs::{Clipboard, ClipboardContext, ContentFormat};
use std::path::PathBuf;
use url::Url;

fn local_file_path(value: &str) -> Result<PathBuf, String> {
    let path = if value.starts_with("file:") {
        Url::parse(value)
            .map_err(|error| format!("剪贴板文件地址无效：{error}"))?
            .to_file_path()
            .map_err(|_| "剪贴板文件地址不是本地路径".to_string())?
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() {
        return Err("剪贴板文件路径必须是绝对路径".to_string());
    }
    Ok(path)
}

pub(crate) fn read_paths() -> Result<Vec<PathBuf>, String> {
    let clipboard =
        ClipboardContext::new().map_err(|error| format!("无法访问系统剪贴板：{error}"))?;
    if !clipboard.has(ContentFormat::Files) {
        return Ok(Vec::new());
    }
    clipboard
        .get_files()
        .map_err(|error| format!("无法读取复制的文件，请重新复制后粘贴：{error}"))?
        .iter()
        .map(|value| local_file_path(value))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::local_file_path;

    #[test]
    fn accepts_local_file_urls_with_spaces_and_unicode() {
        #[cfg(windows)]
        let value = "file:///C:/documents/%E8%B5%84%E6%96%99%20test.docx";
        #[cfg(not(windows))]
        let value = "file:///documents/%E8%B5%84%E6%96%99%20test.docx";
        let path = local_file_path(value).unwrap();
        assert_eq!(path.file_name().unwrap(), "资料 test.docx");
    }

    #[test]
    fn refuses_text_and_remote_web_urls() {
        for value in ["report.pdf", "https://example.com/report.pdf", "not a file"] {
            assert!(local_file_path(value).is_err());
        }
    }

    #[test]
    fn accepts_native_absolute_file_paths() {
        let path = std::env::temp_dir().join("资料 test.xlsx");
        assert_eq!(local_file_path(path.to_str().unwrap()).unwrap(), path);
    }
}
