import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


project_root = Path(__file__).resolve().parents[1]
build_directory = Path(
    os.environ.get("PUSH_SMOKE_WEB_ROOT", project_root / "BulkaAndroid" / "build" / "web")
).resolve()
server = ThreadingHTTPServer(
    ("127.0.0.1", 0), partial(QuietHandler, directory=str(build_directory))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE_URL = os.environ.get(
    "PUSH_SMOKE_BASE_URL", f"http://127.0.0.1:{server.server_port}"
)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    console_errors = []
    page_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto(BASE_URL, wait_until="networkidle")
    worker_response = page.request.get(f"{BASE_URL}/firebase-messaging-sw.js")
    assert worker_response.ok, "firebase-messaging-sw.js is missing from the web build"
    assert "firebase.messaging()" in worker_response.text()

    page.evaluate(
        """async () => {
          const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
          await navigator.serviceWorker.ready;
          return registration.scope;
        }"""
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(500)
    workers = page.evaluate(
        """async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
          scope: registration.scope,
          scriptURL: (registration.active || registration.waiting || registration.installing)?.scriptURL || ''
        }))"""
    )
    firebase_workers = [
        worker for worker in workers if worker["scriptURL"].endswith("firebase-messaging-sw.js")
    ]
    assert firebase_workers, "Firebase Messaging worker was removed during Flutter bootstrap"

    fatal_messages = [
        message
        for message in [*console_errors, *page_errors]
        if "Push initialization unavailable" in message
        or "Null check operator used on a null value" in message
    ]
    assert not fatal_messages, "Firebase initialization failed: " + " | ".join(fatal_messages)

    print(
        json.dumps(
            {
                "worker": firebase_workers[0],
                "consoleErrorCount": len(console_errors),
                "pageErrorCount": len(page_errors),
                "firebaseInitializationErrors": fatal_messages,
            },
            ensure_ascii=False,
        )
    )
    browser.close()

server.shutdown()
server.server_close()
