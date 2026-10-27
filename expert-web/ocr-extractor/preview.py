"""Loopback-only visual preview with a one-use fixture identity; not production."""
import secrets
import tempfile
import threading
from server import create_server


def main():
    with tempfile.TemporaryDirectory(prefix="ocr-visual-preview-") as directory:
        ticket = secrets.token_hex(32)
        consumed = False
        lock = threading.Lock()
        def redeem(value):
            nonlocal consumed
            with lock:
                if value != ticket or consumed:
                    raise ValueError("Invalid or consumed visual fixture ticket")
                consumed = True
                return {"user_id": "1"}
        server = create_server(directory, ("127.0.0.1", 0), redeem_ticket=redeem, preview=True)
        server.RequestHandlerClass.preview_origin = f"http://127.0.0.1:{server.server_port}"
        print(f"LOCAL PREVIEW ONLY: http://127.0.0.1:{server.server_port}/#ticket={ticket}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            server.worker.close()


if __name__ == "__main__":
    main()
