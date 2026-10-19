"""Local integration tests for price quotes and stored checkout orders."""

from __future__ import annotations

import json
import math
import secrets
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from decimal import Decimal, ROUND_HALF_UP
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as store


class QuietHandler(store.Handler):
    def log_message(self, fmt, *args):
        pass


class CheckoutApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_workspace = Path(__file__).resolve().parents[1] / "work"
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="vinayak-checkout-test-", dir=test_workspace)
        cls.original_db_path = store.DB_PATH
        cls.original_database_url = store.DATABASE_URL
        store.DB_PATH = Path(cls.temp_dir.name) / "test.sqlite3"
        store.DATABASE_URL = ""
        store.init_db()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)
        store.DB_PATH = cls.original_db_path
        store.DATABASE_URL = cls.original_database_url
        cls.temp_dir.cleanup()

    def request(self, path, data=None, headers=None, method=None):
        body = None if data is None else json.dumps(data).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method or ("POST" if body is not None else "GET"),
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8")), response.headers
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8")
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {}
            return error.code, payload, error.headers

    def available_product(self):
        with store.db() as con:
            row = con.execute("SELECT id, name, price FROM products WHERE available=1 ORDER BY id LIMIT 1").fetchone()
        self.assertIsNotNone(row)
        return row

    @staticmethod
    def amount(price, quantity):
        unit = Decimal(str(price)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return float((unit * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    def order_payload(self, product, quantity=1, expected_total=None, request_key=None):
        return {
            "idempotencyKey": request_key or uuid.uuid4().hex,
            "customer": {
                "name": "Checkout Test Customer",
                "phone": "98765-43210",
                "address": "123 Test Lane\nHoshiarpur, Punjab 146001",
            },
            "items": [{"id": product["id"], "quantity": quantity, "price": 0}],
            "expectedSubtotal": expected_total if expected_total is not None else self.amount(product["price"], quantity),
        }

    def test_current_catalogue_is_available_through_api_and_snapshot(self):
        status, api_products, _ = self.request("/api/products")
        self.assertEqual(status, 200)
        snapshot_status, snapshot_products, snapshot_headers = self.request("/data/products.json")
        self.assertEqual(snapshot_status, 200)
        self.assertEqual(len(api_products), len(snapshot_products))
        self.assertEqual(snapshot_headers.get("Cache-Control"), "no-cache")

    def test_quote_uses_database_prices_and_delivery_rule(self):
        product = self.available_product()
        quantity = max(1, math.ceil(float(store.FREE_DELIVERY_THRESHOLD) / float(product["price"])))
        status, quote, _ = self.request("/api/checkout/quote", {"items": [{"id": product["id"], "quantity": quantity, "price": 0}]})
        self.assertEqual(status, 200)
        self.assertEqual(quote["items"][0]["price"], float(product["price"]))
        self.assertEqual(quote["delivery"]["status"], "area_check_pending")
        self.assertIsNone(quote["total"])
        self.assertEqual(quote["subtotal"], self.amount(product["price"], quantity))

    def test_order_uses_server_prices_stores_pii_privately_and_retries_idempotently(self):
        product = self.available_product()
        payload = self.order_payload(product, quantity=2)
        status, order, _ = self.request("/api/checkout/order", payload)
        self.assertEqual(status, 201)
        self.assertRegex(order["orderId"], r"^VS-\d{8}-[A-F0-9]{8}$")
        self.assertEqual(order["customer"]["phone"], "+919876543210")
        self.assertEqual(order["items"][0]["price"], float(product["price"]))
        self.assertEqual(order["subtotal"], self.amount(product["price"], 2))
        self.assertEqual(order["paymentStatus"], "not_taken")
        self.assertIsNone(order["total"])
        self.assertIsNone(order["deliveryCharge"])
        expected_delivery_status = "area_check_pending" if order["subtotal"] >= float(store.FREE_DELIVERY_THRESHOLD) else "charge_pending"
        self.assertEqual(order["deliveryStatus"], expected_delivery_status)

        retry_status, retry, _ = self.request("/api/checkout/order", payload)
        self.assertEqual(retry_status, 200)
        self.assertEqual(retry["orderId"], order["orderId"])
        with store.db() as con:
            count = con.execute("SELECT COUNT(*) FROM orders WHERE idempotency_hash=?", (store.hashlib.sha256(payload["idempotencyKey"].encode()).hexdigest(),)).fetchone()[0]
        self.assertEqual(count, 1)

        public_status, _, _ = self.request(f"/api/orders/{order['orderId']}")
        self.assertEqual(public_status, 404)
        admin_status, _, _ = self.request("/api/admin/orders")
        self.assertEqual(admin_status, 401)

        username = "test_" + uuid.uuid4().hex[:12]
        password = secrets.token_urlsafe(24)
        password_hash, salt = store.hash_password(password)
        with store.db() as con:
            con.execute("INSERT INTO admin_users(username,password_hash,salt,created_at) VALUES(?,?,?,?)", (username, password_hash, salt, store.now()))
        login_status, login, login_headers = self.request("/api/auth/login", {"username": username, "password": password})
        self.assertEqual(login_status, 200)
        cookie = login_headers.get("Set-Cookie", "").split(";", 1)[0]
        headers = {"Cookie": cookie, "X-CSRF-Token": login["csrfToken"], "Origin": self.base_url}
        admin_status, admin_orders, _ = self.request("/api/admin/orders", headers=headers)
        self.assertEqual(admin_status, 200)
        self.assertTrue(any(item["orderId"] == order["orderId"] for item in admin_orders))
        update_status, updated, _ = self.request(f"/api/admin/orders/{order['orderId']}", {"status": "processing"}, headers=headers, method="PUT")
        self.assertEqual(update_status, 200)
        self.assertEqual(updated["status"], "processing")
        charge_status, confirmed, _ = self.request(f"/api/admin/orders/{order['orderId']}", {"deliveryCharge": 0}, headers=headers, method="PUT")
        self.assertEqual(charge_status, 200)
        self.assertEqual(confirmed["deliveryStatus"], "confirmed")
        self.assertEqual(confirmed["deliveryCharge"], 0)
        self.assertEqual(confirmed["total"], order["subtotal"])

    def test_checkout_rejects_empty_cart_bad_phone_and_manipulated_total(self):
        empty_payload = {"idempotencyKey": uuid.uuid4().hex, "customer": {"name": "Test", "phone": "9876543210", "address": "Test address"}, "items": [], "expectedSubtotal": 0}
        self.assertEqual(self.request("/api/checkout/order", empty_payload)[0], 400)

        product = self.available_product()
        bad_phone = self.order_payload(product)
        bad_phone["customer"]["phone"] = "123"
        self.assertEqual(self.request("/api/checkout/order", bad_phone)[0], 400)

        manipulated_subtotal = self.order_payload(product, expected_total=0)
        status, response, _ = self.request("/api/checkout/order", manipulated_subtotal)
        self.assertEqual(status, 409)
        self.assertIn("quote", response)
        self.assertEqual(response["quote"]["items"][0]["price"], float(product["price"]))

        stale_price = self.order_payload(product)
        with store.db() as con:
            original_price = con.execute("SELECT price FROM products WHERE id=?", (product["id"],)).fetchone()[0]
            con.execute("UPDATE products SET price=? WHERE id=?", (float(original_price) + 1, product["id"]))
        try:
            status, response, _ = self.request("/api/checkout/order", stale_price)
            self.assertEqual(status, 409)
            self.assertIn("quote", response)
            self.assertEqual(response["quote"]["items"][0]["price"], float(original_price) + 1)
        finally:
            with store.db() as con:
                con.execute("UPDATE products SET price=? WHERE id=?", (original_price, product["id"]))


if __name__ == "__main__":
    unittest.main()
