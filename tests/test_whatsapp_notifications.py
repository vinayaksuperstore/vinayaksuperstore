"""Unit tests for private, template-based WhatsApp owner alerts."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as store


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return b'{"messages":[{"id":"wamid.test-alert"}]}'


class WhatsAppNotificationTests(unittest.TestCase):
    def test_sends_approved_template_with_order_summary_only(self):
        settings = {
            "access_token": "test-secret-token",
            "phone_number_id": "123456789012345",
            "recipient": "919876543210",
            "template": "new_website_order",
            "language": "en_US",
            "api_version": "v25.0",
        }
        order = {
            "order_id": "VS-20261019-ABC12345",
            "subtotal": 123.5,
            "items_json": json.dumps([
                {"id": 1, "name": "Parle-G", "quantity": 2, "price": 5, "subtotal": 10},
                {"id": 2, "name": "Rice", "quantity": 1, "price": 113.5, "subtotal": 113.5},
            ]),
            "customer_name": "Private Customer Name",
            "customer_phone": "+919876543210",
            "customer_address": "Private Customer Address",
        }
        with patch.object(store, "urlopen", return_value=FakeResponse()) as send:
            message_id = store.send_whatsapp_order_alert(order, settings)

        self.assertEqual(message_id, "wamid.test-alert")
        request = send.call_args.args[0]
        self.assertEqual(request.full_url, "https://graph.facebook.com/v25.0/123456789012345/messages")
        self.assertEqual(request.headers["Authorization"], "Bearer test-secret-token")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["to"], "919876543210")
        self.assertEqual(payload["template"]["name"], "new_website_order")
        parameters = payload["template"]["components"][0]["parameters"]
        self.assertEqual([parameter["text"] for parameter in parameters], [order["order_id"], "3", "123.50"])
        serialized = json.dumps(payload)
        self.assertNotIn(order["customer_name"], serialized)
        self.assertNotIn(order["customer_phone"], serialized)
        self.assertNotIn(order["customer_address"], serialized)

    def test_alert_settings_require_credentials_and_recipient(self):
        with patch.dict("os.environ", {}, clear=True):
            settings, missing = store.whatsapp_alert_settings()
        self.assertIsNone(settings)
        self.assertIn("WHATSAPP_ACCESS_TOKEN", missing)
        self.assertIn("WHATSAPP_ALERT_RECIPIENT", missing)


if __name__ == "__main__":
    unittest.main()
