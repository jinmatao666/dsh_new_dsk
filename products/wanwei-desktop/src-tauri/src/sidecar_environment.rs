//! macOS-only shell environment fixes. Windows and Linux retain their launch environment.
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

/// Apply macOS runtime discovery and sandbox-compatible Python cache locations.
pub fn configure(command: &mut Command, program: &Path, app_data: &Path) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let path = mac_path(program, std::env::var_os("PATH"))?;
    command.env("PATH", path);
    let root = cache_root(&std::env::temp_dir(), app_data);
    private_directory(&root, app_data)?;
    let userbase = root.join("userbase");
    let pip_cache = root.join("pip-cache");
    for directory in [&userbase, &pip_cache] {
        private_directory(directory, app_data)?;
    }
    command
        .env("PYTHONUSERBASE", userbase)
        .env("PIP_CACHE_DIR", pip_cache);
    Ok(())
}

fn mac_path(program: &Path, inherited: Option<OsString>) -> Result<OsString, String> {
    let mut paths = Vec::new();
    if program.is_absolute() {
        if let Some(parent) = program.parent() {
            paths.push(parent.to_path_buf());
        }
    }
    if let Some(value) = inherited {
        paths.extend(std::env::split_paths(&value).filter(|path| !path.as_os_str().is_empty()));
    }
    for path in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        let path = PathBuf::from(path);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    std::env::join_paths(paths).map_err(|error| format!("Unable to prepare desktop PATH: {error}"))
}

fn cache_root(temp: &Path, app_data: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    // Separate development/preview products without putting writable caches in DSH_HOME.
    let digest = Sha256::digest(app_data.as_os_str().to_string_lossy().as_bytes());
    temp.join(format!("wanwei-python-{:x}", digest))
}

fn private_directory(path: &Path, app_data: &Path) -> Result<(), String> {
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder
    };
    #[cfg(not(unix))]
    let builder = fs::DirBuilder::new();
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!(
                "Unable to create Python cache {}: {error}",
                path.display()
            ))
        }
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_dir() {
        return Err(format!(
            "Python cache is not a real directory: {}",
            path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let owner = fs::metadata(app_data)
            .map_err(|error| error.to_string())?
            .uid();
        if metadata.uid() != owner || metadata.mode() & 0o077 != 0 {
            return Err(format!(
                "Python cache is not private to this user: {}",
                path.display()
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = app_data;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_path_keeps_bundled_node_first_and_existing_tools_before_homebrew() {
        let inherited = std::env::join_paths(["/custom/bin", "/usr/bin"]).unwrap();
        let runtime = std::env::current_dir().unwrap().join("Buddy.app/runtime");
        let value = mac_path(&runtime.join("node"), Some(inherited)).unwrap();
        let paths: Vec<_> = std::env::split_paths(&value).collect();
        assert_eq!(paths[0], runtime);
        assert_eq!(paths[1], PathBuf::from("/custom/bin"));
        assert_eq!(
            paths
                .iter()
                .filter(|path| **path == PathBuf::from("/usr/bin"))
                .count(),
            1
        );
        assert!(paths.contains(&PathBuf::from("/opt/homebrew/bin")));
    }

    #[test]
    fn bare_development_node_does_not_add_current_directory_to_path() {
        let value = mac_path(Path::new("node"), None).unwrap();
        assert!(std::env::split_paths(&value)
            .all(|path| !path.as_os_str().is_empty() && path != Path::new(".")));
    }

    #[test]
    fn cache_is_in_host_temp_stable_per_product_and_separate_from_other_products() {
        let temp = Path::new("/host/tmp");
        let preview = Path::new("/data/preview");
        assert!(cache_root(temp, preview).starts_with(temp));
        assert_eq!(cache_root(temp, preview), cache_root(temp, preview));
        assert_ne!(
            cache_root(temp, preview),
            cache_root(temp, Path::new("/data/development"))
        );
    }

    #[test]
    fn other_platforms_do_not_change_command_environment() {
        if cfg!(target_os = "macos") {
            return;
        }
        let mut command = Command::new("node");
        command
            .env("PATH", "existing")
            .env("TMPDIR", "existing-temp");
        let before: Vec<_> = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsString::from)))
            .collect();
        configure(&mut command, Path::new("node"), Path::new("missing")).unwrap();
        let after: Vec<_> = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(OsString::from)))
            .collect();
        assert_eq!(before, after);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_configuration_preserves_temp_and_uses_private_host_temp_cache() {
        let app_data = std::env::temp_dir();
        let program = std::env::current_exe().unwrap();
        let mut command = Command::new(&program);
        command.env("TMPDIR", "inherited-temp");
        configure(&mut command, &program, &app_data).unwrap();
        let env: std::collections::BTreeMap<_, _> = command.get_envs().collect();
        assert_eq!(
            env[std::ffi::OsStr::new("TMPDIR")],
            Some(std::ffi::OsStr::new("inherited-temp"))
        );
        let userbase = PathBuf::from(env[std::ffi::OsStr::new("PYTHONUSERBASE")].unwrap());
        assert!(userbase.starts_with(std::env::temp_dir()));
        use std::os::unix::fs::MetadataExt;
        assert_eq!(fs::metadata(userbase).unwrap().mode() & 0o077, 0);
    }

    #[test]
    fn cache_directory_is_reusable_but_refuses_a_file() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("wanwei-cache-test-{}-{stamp}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let cache = root.join("cache");
        private_directory(&cache, &root).unwrap();
        private_directory(&cache, &root).unwrap();
        let file = root.join("file");
        fs::write(&file, b"existing").unwrap();
        assert!(private_directory(&file, &root).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"existing");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn cache_refuses_symlinks_and_nonprivate_directories() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "wanwei-cache-security-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        let target = root.join("target");
        private_directory(&target, &root).unwrap();
        let link = root.join("link");
        symlink(&target, &link).unwrap();
        assert!(private_directory(&link, &root).is_err());
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(private_directory(&target, &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
