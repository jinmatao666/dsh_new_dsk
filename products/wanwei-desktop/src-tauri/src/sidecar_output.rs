use std::io::BufRead;
use std::sync::mpsc::Sender;
use url::Url;

/// Reap a failed startup before its child handle leaves the caller.
pub fn finish_startup(
    child: &mut std::process::Child,
    result: Result<Url, String>,
) -> Result<Url, String> {
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

/// Keep draining stdout after announcing readiness, even after the receiver closes.
pub fn drain(reader: impl BufRead, sender: Sender<Url>, mut log: impl FnMut(&str)) {
    let mut announced = false;
    for line in reader.lines().map_while(Result::ok) {
        log(&line);
        if !announced {
            if let Some(raw) = line.strip_prefix("dsh web: ") {
                if let Ok(url) = Url::parse(raw.split_whitespace().next().unwrap_or(raw)) {
                    let _ = sender.send(url);
                    announced = true;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::mpsc;

    #[test]
    fn startup_probe() {
        if std::env::var_os("WANWEI_STARTUP_TEST_CHILD").is_some() {
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    }

    #[test]
    fn failed_startup_reaps_the_child_before_returning() {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "sidecar_output::tests::startup_probe"])
            .env("WANWEI_STARTUP_TEST_CHILD", "1")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let result = finish_startup(&mut child, Err("startup timed out".to_owned()));
        assert_eq!(result.unwrap_err(), "startup timed out");
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn drains_output_after_readiness_and_announces_only_once() {
        let (sender, receiver) = mpsc::channel();
        let source = "warming up\ndsh web: http://127.0.0.1:1234/?token=test\nafter ready\ndsh web: http://127.0.0.1:9999/\nlast line\n";
        let mut lines = Vec::new();
        drain(Cursor::new(source), sender, |line| {
            lines.push(line.to_owned())
        });
        assert_eq!(lines.len(), 5);
        assert_eq!(lines.last().unwrap(), "last line");
        assert_eq!(receiver.recv().unwrap().port(), Some(1234));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn closed_receiver_does_not_stop_draining() {
        let (sender, receiver) = mpsc::channel();
        drop(receiver);
        let source = format!(
            "dsh web: http://127.0.0.1:1234/\n{}\nend\n",
            "x".repeat(131072)
        );
        let mut count = 0;
        drain(Cursor::new(source), sender, |_| count += 1);
        assert_eq!(count, 3);
    }
}
