"""Local visual fixture only: never publish this server or use production credentials."""
import secrets
import socket
import tempfile
from threading import Lock

from server import create_server


def main():
    with tempfile.TemporaryDirectory(prefix="expert-visual-preview-") as directory:
        ticket = secrets.token_hex(32)
        lock = Lock()
        consumed = False
        def identity(value):
            nonlocal consumed
            with lock:
                if value != ticket or consumed:
                    raise ValueError("Invalid or already consumed local fixture ticket")
                consumed = True
                return {"user_id": "local-visual-fixture"}
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        app = create_server(directory, ("127.0.0.1", port), redeem_ticket=identity,
                            public_url=f"http://127.0.0.1:{port}")
        print(f"LOCAL FIXTURE ONLY: http://127.0.0.1:{app.server_port}/#ticket={ticket}", flush=True)
        try:
            app.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            app.server_close()
            app.worker.close()


if __name__ == "__main__":
    main()
