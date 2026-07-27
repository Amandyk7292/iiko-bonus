from pathlib import Path
from urllib.parse import urlparse
import base64
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4179/admin/whatsapp"
WHATSAPP_URL = (
    BASE_URL.rstrip("/")
    if BASE_URL.rstrip("/").endswith("/whatsapp")
    else f"{BASE_URL.rstrip('/')}/whatsapp"
)
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "scratch"
SCREENSHOTS.mkdir(exist_ok=True)

SETTINGS = {
    "assistantEnabled": True,
    "autoReplyEnabled": True,
    "memoryEnabled": True,
    "provider": "gemini",
    "model": "gemini-3.1-flash-lite",
    "keyConfigured": True,
    "providerKeys": {"gemini": True, "qwen": False, "deepseek": False},
    "botName": "Ассистент Bulka",
    "tone": "friendly",
    "supportedLanguages": ["ru", "kk", "en"],
    "historyMessages": 12,
    "businessDescription": "Городская пекарня Bulka в Астане",
    "customInstructions": "Не обещать наличие без проверки",
    "welcomeMessage": "Здравствуйте! Чем помочь?",
    "fallbackMessage": "Подключаем оператора.",
    "storageReady": True,
    "updatedAt": "2026-07-22T08:00:00Z",
}
CONVERSATION = {
    "id": "10000000-0000-4000-8000-000000000001",
    "chatJid": "77001234567@s.whatsapp.net",
    "phone": "+7 700 123 45 67",
    "displayName": "Алия",
    "status": "open",
    "assistantEnabled": True,
    "contextResetAt": None,
    "unreadCount": 2,
    "lastMessagePreview": "Есть ли миндальный круассан?",
    "lastMessageAt": "2026-07-22T08:15:00Z",
    "lastCustomerMessageAt": "2026-07-22T08:15:00Z",
    "lastOperatorMessageAt": None,
    "createdAt": "2026-07-22T08:00:00Z",
    "updatedAt": "2026-07-22T08:15:00Z",
}
MESSAGES = [
    {
        "id": "20000000-0000-4000-8000-000000000001",
        "conversationId": CONVERSATION["id"],
        "whatsappMessageId": "wa-in-1",
        "direction": "inbound",
        "senderType": "customer",
        "content": "Здравствуйте! Есть ли миндальный круассан?",
        "deliveryStatus": "received",
        "createdAt": "2026-07-22T08:14:00Z",
    },
    {
        "id": "20000000-0000-4000-8000-000000000002",
        "conversationId": CONVERSATION["id"],
        "whatsappMessageId": "wa-out-1",
        "direction": "outbound",
        "senderType": "assistant",
        "content": "Да, он есть в меню. Наличие в филиале лучше уточнить перед поездкой.",
        "deliveryStatus": "delivered",
        "createdAt": "2026-07-22T08:15:00Z",
    },
]
MEMORIES = [
    {
        "id": "30000000-0000-4000-8000-000000000001",
        "conversationId": CONVERSATION["id"],
        "label": "Предпочтение",
        "content": "Интересуется выпечкой с миндалём",
        "sourceType": "manual",
        "sourceMessageId": None,
        "isActive": True,
        "createdAt": "2026-07-22T08:10:00Z",
        "updatedAt": "2026-07-22T08:10:00Z",
    }
]
DOCUMENTS = [
    {
        "id": "40000000-0000-4000-8000-000000000001",
        "title": "Аллергены в выпечке",
        "category": "menu",
        "content": "Информацию по аллергенам нужно подтверждать по карточке блюда.",
        "isActive": True,
        "createdAt": "2026-07-22T07:00:00Z",
        "updatedAt": "2026-07-22T07:30:00Z",
    }
]

captured = {"replies": [], "settings": [], "knowledge": [], "memories": []}
STATUS_MODE = "connected"
QR_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 11 11">
<rect width="11" height="11" fill="white"/><path fill="#21160f" d="M1 1h3v3H1zM7 1h3v3H7zM1 7h3v3H1zM5 5h1v1H5zM7 5h1v1H7zM9 5h1v2H9zM5 7h2v1H5zM8 8h2v2H8zM5 9h2v1H5z"/>
<path fill="white" d="M2 2h1v1H2zM8 2h1v1H8zM2 8h1v1H2z"/></svg>"""
QR_DATA_URL = "data:image/svg+xml;base64," + base64.b64encode(QR_SVG.encode()).decode()


def fulfill_json(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))


def route_api(route):
    request = route.request
    path = urlparse(request.url).path
    method = request.method

    if path.endswith("/admin/api/session"):
        fulfill_json(route, {"user": {"username": "owner", "role": "owner"}})
    elif path.endswith("/admin/api/events"):
        route.fulfill(
            status=200,
            headers={"content-type": "text/event-stream", "cache-control": "no-cache"},
            body="event: connected\ndata: {}\n\n",
        )
    elif path.endswith("/admin/api/whatsapp/status"):
        awaiting_scan = STATUS_MODE == "awaiting_scan"
        fulfill_json(
            route,
            {
                "success": True,
                "connection": {
                    "state": "awaiting_scan" if awaiting_scan else "connected",
                    "connected": not awaiting_scan,
                    "connectedAt": None if awaiting_scan else "2026-07-22T07:00:00Z",
                    "updatedAt": "2026-07-22T08:15:00Z",
                    "phone": "" if awaiting_scan else "+77 ••• ••• 4567",
                    "qrDataUrl": QR_DATA_URL if awaiting_scan else "",
                    "qrReceivedAt": "2026-07-22T08:15:00Z" if awaiting_scan else None,
                    "lastError": "",
                    "assistant": {
                        "environmentEnabled": True,
                        "provider": "gemini",
                        "keyConfigured": True,
                        "model": "gemini-3.1-flash-lite",
                    },
                },
                "settings": SETTINGS,
            },
        )
    elif path.endswith("/admin/api/whatsapp/settings") and method == "PUT":
        payload = request.post_data_json
        captured["settings"].append(payload.copy())
        api_key = payload.pop("apiKey", "")
        payload.pop("providerKeys", None)
        payload.pop("keyConfigured", None)
        payload.pop("storageReady", None)
        payload.pop("updatedAt", None)
        SETTINGS.update(payload)
        if api_key:
            SETTINGS["providerKeys"][payload["provider"]] = True
        SETTINGS["keyConfigured"] = SETTINGS["providerKeys"][SETTINGS["provider"]]
        SETTINGS["updatedAt"] = "2026-07-22T09:00:00Z"
        fulfill_json(route, {"success": True, "settings": SETTINGS})
    elif path.endswith("/admin/api/whatsapp/settings"):
        fulfill_json(route, {"success": True, "settings": SETTINGS})
    elif path.endswith("/admin/api/whatsapp/conversations"):
        fulfill_json(
            route,
            {
                "success": True,
                "conversations": [CONVERSATION],
                "total": 1,
                "unread": CONVERSATION["unreadCount"],
            },
        )
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}/messages"):
        payload = request.post_data_json
        captured["replies"].append(payload)
        CONVERSATION.update({"assistantEnabled": False, "unreadCount": 0})
        message = {
            "id": "20000000-0000-4000-8000-000000000003",
            "conversationId": CONVERSATION["id"],
            "whatsappMessageId": "wa-operator-1",
            "direction": "outbound",
            "senderType": "operator",
            "content": payload["text"],
            "deliveryStatus": "sent",
            "createdAt": "2026-07-22T09:00:00Z",
        }
        fulfill_json(route, {"success": True, "message": message, "conversation": CONVERSATION})
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}/memories"):
        payload = request.post_data_json
        captured["memories"].append(payload)
        memory = {
            "id": "30000000-0000-4000-8000-000000000002",
            "conversationId": CONVERSATION["id"],
            "label": payload["label"],
            "content": payload["content"],
            "sourceType": payload.get("sourceType", "manual"),
            "sourceMessageId": payload.get("sourceMessageId"),
            "isActive": True,
            "createdAt": "2026-07-22T09:00:00Z",
            "updatedAt": "2026-07-22T09:00:00Z",
        }
        fulfill_json(route, {"success": True, "memory": memory})
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}") and method == "PATCH":
        payload = request.post_data_json
        if payload.get("markRead") is True:
            CONVERSATION["unreadCount"] = 0
        if "assistantEnabled" in payload:
            CONVERSATION["assistantEnabled"] = payload["assistantEnabled"]
        if "status" in payload:
            CONVERSATION["status"] = payload["status"]
        fulfill_json(route, {"success": True, "conversation": CONVERSATION})
    elif path.endswith(f"/admin/api/whatsapp/conversations/{CONVERSATION['id']}"):
        fulfill_json(
            route,
            {
                "success": True,
                "conversation": CONVERSATION,
                "messages": MESSAGES,
                "memories": MEMORIES,
            },
        )
    elif path.endswith("/admin/api/whatsapp/knowledge") and method == "POST":
        payload = request.post_data_json
        captured["knowledge"].append(payload)
        document = {
            "id": "40000000-0000-4000-8000-000000000002",
            **payload,
            "createdAt": "2026-07-22T09:00:00Z",
            "updatedAt": "2026-07-22T09:00:00Z",
        }
        DOCUMENTS.append(document)
        fulfill_json(route, {"success": True, "document": document})
    elif path.endswith("/admin/api/whatsapp/knowledge"):
        fulfill_json(route, {"success": True, "documents": DOCUMENTS})
    else:
        fulfill_json(route, {"success": True})


def assert_no_overflow(page, label):
    layout = page.evaluate(
        """() => ({
          viewport: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          offenders: [...document.querySelectorAll('button, input, textarea, h1, h2, h3, p, .card')]
            .filter(element => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            })
            .filter(element => !element.closest('[aria-hidden="true"], .sagi-sidebar'))
            .map(element => {
              const rect = element.getBoundingClientRect();
              return { text: (element.textContent || '').trim().slice(0, 60), left: rect.left, right: rect.right };
            })
            .filter(item => item.left < -1 || item.right > document.documentElement.clientWidth + 1),
        })"""
    )
    assert layout["documentWidth"] <= layout["viewport"], f"document overflow {label}: {layout}"
    assert layout["bodyWidth"] <= layout["viewport"], f"body overflow {label}: {layout}"
    assert not layout["offenders"], f"visible elements overflow {label}: {layout['offenders']}"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 960},
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text) if message.type == "error" else None,
    )
    page.route("**/admin/api/**", route_api)

    page.goto(WHATSAPP_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="WhatsApp и ИИ-ассистент").wait_for()
    page.get_by_role("heading", name="WhatsApp подключён").wait_for()
    page.get_by_text("Алия", exact=True).first.wait_for()
    page.get_by_text("Есть ли миндальный круассан?", exact=False).first.wait_for()
    page.get_by_text("Интересуется выпечкой с миндалём", exact=True).wait_for()
    assert_no_overflow(page, "desktop inbox")
    page.screenshot(path=str(SCREENSHOTS / "whatsapp-console-desktop.png"), full_page=True)

    page.get_by_label("Ответ клиенту").fill("Здравствуйте! Проверим наличие и скоро ответим.")
    page.get_by_role("button", name="Отправить сообщение").click()
    page.get_by_text("Режим оператора", exact=False).wait_for()
    assert captured["replies"][-1]["text"].startswith("Здравствуйте")

    page.locator("#whatsapp-memory-content").fill("Предпочитает общение на русском языке")
    page.get_by_role("button", name="Сохранить в память").click()
    page.get_by_text("Предпочитает общение на русском языке", exact=True).wait_for()
    assert captured["memories"][-1]["sourceType"] == "manual"

    page.get_by_role("tab", name="База знаний").click()
    page.get_by_text("Аллергены в выпечке", exact=True).wait_for()
    page.get_by_role("button", name="Добавить материал").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("Название").fill("Предзаказ тортов")
    dialog.get_by_label("Информация для ассистента").fill("Срок готовности подтверждает оператор.")
    dialog.get_by_role("button", name="Сохранить").click()
    page.get_by_text("Предзаказ тортов", exact=True).wait_for()
    assert captured["knowledge"][-1]["category"] == "general"

    page.get_by_role("tab", name="Настройки ИИ").click()
    page.get_by_label("Описание Bulka").fill("Сеть городских пекарен Bulka в Астане")
    page.get_by_label("Провайдер").select_option("qwen")
    page.get_by_label("Новый API-ключ Qwen").fill("sk-test-qwen-provider-key")
    page.get_by_role("button", name="Сохранить настройки").click()
    page.get_by_text("Настройки ассистента сохранены", exact=True).wait_for()
    assert captured["settings"][-1]["businessDescription"].endswith("в Астане")
    assert captured["settings"][-1]["provider"] == "qwen"
    assert captured["settings"][-1]["model"] == "qwen-flash"
    assert captured["settings"][-1]["apiKey"] == "sk-test-qwen-provider-key"
    assert_no_overflow(page, "desktop settings")
    page.screenshot(path=str(SCREENSHOTS / "whatsapp-provider-settings-desktop.png"), full_page=True)

    page.set_viewport_size({"width": 375, "height": 812})
    page.goto(WHATSAPP_URL)
    page.get_by_role("heading", name="WhatsApp и ИИ-ассистент").wait_for()
    page.get_by_text("Алия", exact=True).first.wait_for()
    skip_box = page.locator(".skip-link").bounding_box()
    assert skip_box is not None and skip_box["y"] + skip_box["height"] <= 0, (
        f"skip link remained over the mobile title: {skip_box}"
    )
    assert_no_overflow(page, "mobile list")
    page.get_by_text("Алия", exact=True).first.click()
    page.get_by_label("Ответ клиенту").wait_for()
    assert_no_overflow(page, "mobile chat")
    page.screenshot(path=str(SCREENSHOTS / "whatsapp-console-mobile.png"), full_page=True)
    page.get_by_role("tab", name="Настройки ИИ").click()
    page.get_by_label("Провайдер").wait_for()
    assert_no_overflow(page, "mobile provider settings")
    page.screenshot(path=str(SCREENSHOTS / "whatsapp-provider-settings-mobile.png"), full_page=True)

    STATUS_MODE = "awaiting_scan"
    page.set_viewport_size({"width": 1024, "height": 900})
    page.goto(WHATSAPP_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="Нужно связать WhatsApp").wait_for()
    page.get_by_role("img", name="QR-код для подключения WhatsApp").wait_for()
    page.get_by_text("Отсканируйте этот QR-код.", exact=True).wait_for()
    assert_no_overflow(page, "admin QR pairing")
    page.screenshot(path=str(SCREENSHOTS / "whatsapp-qr-admin.png"), full_page=True)

    unexpected_errors = [error for error in console_errors if "401" not in error]
    assert not unexpected_errors, f"browser console errors: {unexpected_errors}"
    print("WhatsApp admin UI E2E passed")
    context.close()
    browser.close()
