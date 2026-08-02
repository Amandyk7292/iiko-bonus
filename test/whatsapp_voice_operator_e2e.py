from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "http://127.0.0.1:4319/admin/whatsapp-access#operator-voice-test"
)
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "artifacts" / "whatsapp-voice-operator.png"
SCREENSHOT.parent.mkdir(exist_ok=True)

NOW = "2026-07-22T10:00:00.000Z"
CONVERSATION = {
    "id": "11111111-1111-4111-8111-111111111111",
    "chatJid": "77001234567@s.whatsapp.net",
    "phone": "+7 700 123 45 67",
    "displayName": "Клиент Bulka",
    "status": "open",
    "assistantEnabled": True,
    "contextResetAt": None,
    "unreadCount": 0,
    "lastMessagePreview": "Здравствуйте, есть ли круассаны?",
    "lastMessageAt": NOW,
    "lastCustomerMessageAt": NOW,
    "lastOperatorMessageAt": None,
    "createdAt": NOW,
    "updatedAt": NOW,
}
MESSAGES = [
    {
        "id": "33333333-3333-4333-8333-333333333333",
        "conversationId": CONVERSATION["id"],
        "whatsappMessageId": "wa-in-1",
        "direction": "inbound",
        "senderType": "customer",
        "content": "Здравствуйте, есть ли круассаны?",
        "deliveryStatus": "received",
        "createdAt": NOW,
    }
]
captured_voice_requests = []
STATUS_MODE = "connected"


def fulfill_json(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))


def route_api(route):
    request = route.request
    path = urlparse(request.url).path
    method = request.method

    if path.endswith("/admin/api/whatsapp/operator-access"):
        fulfill_json(
            route,
            {
                "user": {
                    "username": "whatsapp-operator",
                    "role": "whatsapp_operator",
                    "branchIds": [],
                }
            },
        )
    elif path.endswith("/admin/api/whatsapp/status"):
        logged_out = STATUS_MODE == "logged_out"
        fulfill_json(
            route,
            {
                "success": True,
                "settings": None,
                "connection": {
                    "state": "logged_out" if logged_out else "connected",
                    "connected": not logged_out,
                    "connectedAt": None if logged_out else NOW,
                    "updatedAt": NOW,
                    "phone": "" if logged_out else "+7 70• ••• 4567",
                    "qrDataUrl": "data:image/png;base64,operator-must-not-see-this" if logged_out else "",
                    "qrReceivedAt": NOW if logged_out else None,
                    "lastError": "",
                    "assistant": {
                        "environmentEnabled": True,
                        "provider": "gemini",
                        "keyConfigured": True,
                        "model": "gemini-3.1-flash-lite",
                    },
                },
            },
        )
    elif path.endswith("/admin/api/whatsapp/conversations"):
        fulfill_json(
            route,
            {"success": True, "conversations": [CONVERSATION], "total": 1, "unread": 0},
        )
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}/voice"):
        body = request.post_data_buffer or b""
        captured_voice_requests.append(
            {
                "content_type": request.headers.get("content-type", ""),
                "size": len(body),
                "body": body,
            }
        )
        CONVERSATION.update({"assistantEnabled": False, "unreadCount": 0})
        message = {
            "id": "44444444-4444-4444-8444-444444444444",
            "conversationId": CONVERSATION["id"],
            "whatsappMessageId": "wa-voice-1",
            "direction": "outbound",
            "senderType": "operator",
            "content": "🎤 Голосовое сообщение · 0:01",
            "deliveryStatus": "sent",
            "createdAt": NOW,
        }
        fulfill_json(
            route,
            {"success": True, "message": message, "conversation": CONVERSATION},
        )
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}") and method == "PATCH":
        fulfill_json(route, {"success": True, "conversation": CONVERSATION})
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}"):
        fulfill_json(
            route,
            {
                "success": True,
                "conversation": CONVERSATION,
                "messages": MESSAGES,
                "memories": [],
            },
        )
    elif path.endswith("/admin/api/events"):
        route.fulfill(
            status=200,
            headers={
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
            },
            body="event: connected\ndata: {}\n\n",
        )
    else:
        fulfill_json(route, {"success": True})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    )
    context = browser.new_context(viewport={"width": 390, "height": 844}, locale="ru-RU")
    origin = f"{urlparse(BASE_URL).scheme}://{urlparse(BASE_URL).netloc}"
    context.grant_permissions(["microphone"], origin=origin)
    page = context.new_page()
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text) if message.type == "error" else None,
    )
    page.route("**/admin/api/**", route_api)

    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_url("**/admin/whatsapp")
    page.locator(".whatsapp-conversation-item").click()
    page.get_by_label("Записать голосовое").wait_for()

    page.get_by_label("Записать голосовое").click()
    page.get_by_text("Идёт запись", exact=True).wait_for()
    page.wait_for_timeout(500)
    page.get_by_label("Отменить голосовое").click()
    page.get_by_label("Записать голосовое").wait_for()
    assert not captured_voice_requests, "cancelled recording unexpectedly reached the API"

    page.get_by_label("Записать голосовое").click()
    page.get_by_text("Идёт запись", exact=True).wait_for()
    page.wait_for_timeout(800)
    page.screenshot(path=str(SCREENSHOT), full_page=True)
    page.get_by_label("Отправить голосовое").click()
    page.get_by_text("🎤 Голосовое сообщение · 0:01", exact=True).wait_for()

    assert len(captured_voice_requests) == 1
    captured = captured_voice_requests[0]
    assert captured["content_type"].startswith("multipart/form-data; boundary=")
    assert captured["size"] > 100
    assert b'name="audio"' in captured["body"]
    assert b'name="durationSeconds"' in captured["body"]

    STATUS_MODE = "logged_out"
    page.goto(BASE_URL)
    page.wait_for_url("**/admin/whatsapp")
    page.get_by_role("heading", name="WhatsApp вышел из аккаунта").wait_for()
    page.get_by_text("Сообщите владельцу, чтобы он повторно подключил номер", exact=True).wait_for()
    assert page.get_by_role("img", name="QR-код для подключения WhatsApp").count() == 0
    assert not console_errors, f"browser console errors: {console_errors}"

    print("WhatsApp operator voice E2E passed")
    context.close()
    browser.close()
