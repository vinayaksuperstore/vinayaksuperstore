#!/usr/bin/env python3
"""Small same-origin catalogue server for Vinayak Superstore.

Uses only the Python standard library. Run `python server.py --init-admin` once,
then `python server.py` to serve the storefront, admin panel, and protected API.
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("VINAYAK_DB_PATH", ROOT / "data" / "vinayak.sqlite3"))
UPLOAD_DIR = Path(os.environ.get("VINAYAK_UPLOAD_DIR", ROOT / "assets" / "uploads"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
ALLOWED_ORIGINS = {
    value.strip().rstrip("/").lower()
    for value in os.environ.get(
        "ALLOWED_ORIGINS",
        "https://vinayaksuperstore.com,https://www.vinayaksuperstore.com",
    ).split(",")
    if value.strip()
}
SESSION_TTL = 60 * 60 * 12
MAX_JSON_BYTES = 512 * 1024
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PBKDF2_ROUNDS = 310_000
LOGIN_FAILURES: dict[str, list[float]] = {}


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def request_origin_allowed(origin: str | None, host: str) -> bool:
    if not origin:
        return True
    parsed = urlparse(origin)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.params or parsed.query or parsed.fragment):
        return False
    normalized = f"{parsed.scheme}://{parsed.netloc}".lower()
    return normalized in ALLOWED_ORIGINS or parsed.netloc.lower() == host.lower()


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_db() -> None:
    with db() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL CHECK(price >= 0),
                available INTEGER NOT NULL DEFAULT 1,
                product_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
            CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                old_price REAL NOT NULL,
                new_price REAL NOT NULL,
                changed_at TEXT NOT NULL,
                changed_by TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS price_history_product_idx ON price_history(product_id, changed_at DESC);
            CREATE TABLE IF NOT EXISTS admin_users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                csrf_token TEXT NOT NULL,
                username TEXT NOT NULL,
                expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS catalog_sequence (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                next_id INTEGER NOT NULL
            );
        """)
        if con.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            backup = ROOT / "data" / "products.legacy-backup.json"
            if backup.exists():
                records = json.loads(backup.read_text(encoding="utf-8"))
                stamp = now()
                for product in records:
                    product = dict(product)
                    available = bool(int(product.get("stock", 0) or 0) > 0)
                    product["available"] = available
                    con.execute(
                        "INSERT INTO products(id,name,category,price,available,product_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                        (int(product["id"]), str(product["name"]), str(product["category"]), float(product["price"]), int(available), json.dumps(product, ensure_ascii=False), stamp, stamp),
                    )
                    con.execute("INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)", (product["category"], stamp))
        con.execute("INSERT OR IGNORE INTO catalog_sequence(singleton,next_id) VALUES(1,?)", (con.execute("SELECT COALESCE(MAX(id),0)+1 FROM products").fetchone()[0],))


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt).decode("ascii")


def create_first_admin() -> None:
    init_db()
    with db() as con:
        if con.execute("SELECT 1 FROM admin_users LIMIT 1").fetchone():
            raise SystemExit("An admin account already exists. No account was changed.")
    username = input("Admin username: ").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,48}", username):
        raise SystemExit("Use 3–48 letters, numbers, dots, underscores, or hyphens for the username.")
    password = getpass.getpass("Admin password (minimum 12 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if len(password) < 12 or password != confirmation:
        raise SystemExit("Passwords must match and contain at least 12 characters.")
    password_hash, salt = hash_password(password)
    with db() as con:
        con.execute("INSERT INTO admin_users(username,password_hash,salt,created_at) VALUES(?,?,?,?)", (username, password_hash, salt, now()))
    print(f"Admin account '{username}' created. Keep the password private.")


def product_from_row(row: sqlite3.Row) -> dict:
    product = json.loads(row["product_json"])
    product.update({
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "price": row["price"],
        "available": bool(row["available"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    })
    return product


def require_text(value, label: str, maximum: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text.")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > maximum:
        raise ValueError(f"{label} must be {('at most ' if allow_empty else '')}{maximum} characters.")
    return value


def valid_image_path(value) -> str:
    value = require_text(value, "Image", 300, allow_empty=True)
    if not value:
        return "assets/images/placeholder.svg"
    normalized = value.replace("\\", "/").lstrip("/")
    if not normalized.startswith("assets/") or ".." in Path(normalized).parts or re.match(r"^[a-z]+:", normalized, re.I):
        raise ValueError("Choose a project image or upload a PNG, JPEG, or WebP image.")
    return normalized


class Handler(BaseHTTPRequestHandler):
    server_version = "VinayakStore/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status: int, data: dict | list, extra_headers: dict | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' https://unpkg.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, max_bytes: int = MAX_JSON_BYTES) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request length.")
        if length <= 0 or length > max_bytes:
            raise ValueError("Request body is empty or too large.")
        try:
            result = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Send valid JSON.")
        if not isinstance(result, dict):
            raise ValueError("Send a JSON object.")
        return result

    def cookie_value(self, name: str) -> str | None:
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
            return jar[name].value if name in jar else None
        except Exception:
            return None

    def session(self):
        token = self.cookie_value("vinayak_admin")
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", "ignore")).hexdigest()
        with db() as con:
            row = con.execute("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?", (token_hash, time.time())).fetchone()
        return row

    def require_admin(self, csrf: bool = False):
        session = self.session()
        if not session:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in again."})
            return None
        if csrf:
            origin = self.headers.get("Origin")
            if not request_origin_allowed(origin, self.headers.get("Host", "")):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "Request origin was rejected."})
                return None
            supplied = self.headers.get("X-CSRF-Token", "")
            if not hmac.compare_digest(supplied, session["csrf_token"]):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "Security token expired. Reload and try again."})
                return None
        return session

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        try:
            if path == "/api/products":
                with db() as con:
                    rows = con.execute("SELECT * FROM products ORDER BY id").fetchall()
                return self.send_json(200, [product_from_row(row) for row in rows])
            if path == "/api/categories":
                with db() as con:
                    rows = con.execute("SELECT name FROM categories ORDER BY name COLLATE NOCASE").fetchall()
                return self.send_json(200, [row["name"] for row in rows])
            if path == "/api/session":
                session = self.session()
                if not session:
                    return self.send_json(200, {"authenticated": False})
                return self.send_json(200, {"authenticated": True, "username": session["username"], "csrfToken": session["csrf_token"]})
            if path == "/":
                return self.send_file(ROOT / "index.html")
            if path.startswith("/api/admin/"):
                session = self.require_admin()
                if not session:
                    return
                if path == "/api/admin/overview":
                    with db() as con:
                        total, available, category_count = con.execute("SELECT COUNT(*), SUM(available), COUNT(DISTINCT category) FROM products").fetchone()
                        recent = con.execute("SELECT * FROM products ORDER BY updated_at DESC LIMIT 6").fetchall()
                        added = con.execute("SELECT * FROM products ORDER BY created_at DESC LIMIT 6").fetchall()
                    return self.send_json(200, {"total": total, "available": available or 0, "unavailable": total - (available or 0), "categories": category_count, "recentlyUpdated": [product_from_row(r) for r in recent], "recentlyAdded": [product_from_row(r) for r in added]})
                if path == "/api/admin/products":
                    term = query.get("q", [""])[0].strip().lower()
                    category = query.get("category", [""])[0]
                    availability = query.get("availability", [""])[0]
                    sort = query.get("sort", ["name"])[0]
                    allowed_sort = {"name": "name COLLATE NOCASE", "price-low": "price ASC", "price-high": "price DESC", "recent": "created_at DESC", "updated": "updated_at DESC"}
                    clauses, values = [], []
                    if category:
                        clauses.append("category=?"); values.append(category)
                    if availability == "available": clauses.append("available=1")
                    if availability == "unavailable": clauses.append("available=0")
                    if term:
                        clauses.append("(lower(name) LIKE ? OR lower(category) LIKE ? OR lower(product_json) LIKE ?)")
                        values.extend([f"%{term}%"] * 3)
                    where = " WHERE " + " AND ".join(clauses) if clauses else ""
                    with db() as con:
                        rows = con.execute(f"SELECT * FROM products{where} ORDER BY {allowed_sort.get(sort, allowed_sort['name'])}", values).fetchall()
                    return self.send_json(200, [product_from_row(r) for r in rows])
                if path == "/api/admin/price-history":
                    product_id = int(query.get("productId", ["0"])[0])
                    with db() as con:
                        rows = con.execute("SELECT product_id,product_name,old_price,new_price,changed_at,changed_by FROM price_history WHERE product_id=? ORDER BY changed_at DESC LIMIT 50", (product_id,)).fetchall()
                    return self.send_json(200, [dict(row) for row in rows])
                return self.send_json(404, {"error": "Admin route not found."})
            if path == "/admin" or path == "/admin/":
                return self.send_file(ROOT / "admin" / "index.html")
            target = (ROOT / path.lstrip("/")).resolve()
            blocked_parts = {"data", "work", ".git", ".codex", ".agents", "__pycache__"}
            relative = target.relative_to(ROOT) if target.is_relative_to(ROOT) else None
            if (relative is None or any(part in blocked_parts for part in relative.parts)
                    or any(part.startswith(".") for part in relative.parts)
                    or target.suffix.lower() in {".py", ".sqlite", ".sqlite3", ".db", ".pyc"}
                    or not target.is_file()):
                return self.send_error(404)
            return self.send_file(target)
        except (ValueError, sqlite3.Error) as error:
            return self.send_json(400, {"error": str(error)})

    def send_file(self, target: Path):
        try:
            body = target.read_bytes()
        except OSError:
            return self.send_error(404)
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        admin_file = target.is_relative_to(ROOT / "admin")
        policy = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" if admin_file else "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' https://unpkg.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        self.send_header("Content-Security-Policy", policy)
        if target.suffix.lower() in (".html", ".js", ".css"):
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/auth/login":
                data = self.read_json()
                username = require_text(data.get("username"), "Username", 48)
                password = data.get("password")
                if not isinstance(password, str) or len(password) > 512:
                    return self.send_json(400, {"error": "Enter a valid username and password."})
                origin = self.headers.get("Origin")
                if not request_origin_allowed(origin, self.headers.get("Host", "")):
                    return self.send_json(403, {"error": "Request origin was rejected."})
                ip = self.client_address[0]
                attempts = [stamp for stamp in LOGIN_FAILURES.get(ip, []) if time.time() - stamp < 600]
                if len(attempts) >= 8:
                    return self.send_json(429, {"error": "Too many sign-in attempts. Try again in a few minutes."})
                with db() as con:
                    user = con.execute("SELECT * FROM admin_users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
                valid = False
                if user:
                    expected = base64.b64decode(user["password_hash"])
                    salt = base64.b64decode(user["salt"])
                    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
                    valid = hmac.compare_digest(expected, actual)
                else:
                    hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes(16), PBKDF2_ROUNDS)
                if not valid:
                    attempts.append(time.time()); LOGIN_FAILURES[ip] = attempts
                    return self.send_json(401, {"error": "Username or password is incorrect."})
                LOGIN_FAILURES.pop(ip, None)
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
                with db() as con:
                    con.execute("DELETE FROM sessions WHERE expires_at<=?", (time.time(),))
                    con.execute("INSERT INTO sessions(token_hash,csrf_token,username,expires_at) VALUES(?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), csrf, user["username"], time.time() + SESSION_TTL))
                cookie = f"vinayak_admin={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}" + ("; Secure" if COOKIE_SECURE else "")
                return self.send_json(200, {"authenticated": True, "username": user["username"], "csrfToken": csrf}, {"Set-Cookie": cookie})
            if path == "/api/auth/logout":
                session = self.require_admin(csrf=True)
                if not session: return
                token = self.cookie_value("vinayak_admin") or ""
                with db() as con:
                    con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
                cookie = "vinayak_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + ("; Secure" if COOKIE_SECURE else "")
                return self.send_json(200, {"ok": True}, {"Set-Cookie": cookie})
            if path == "/api/checkout/quote":
                data = self.read_json()
                items = data.get("items")
                if not isinstance(items, list) or not items or len(items) > 100:
                    return self.send_json(400, {"error": "Add at least one item to checkout."})
                quote, total = [], 0
                with db() as con:
                    for item in items:
                        if not isinstance(item, dict) or not isinstance(item.get("id"), int) or not isinstance(item.get("quantity"), int) or item["quantity"] < 1 or item["quantity"] > 99:
                            return self.send_json(400, {"error": "Cart quantities must be between 1 and 99."})
                        row = con.execute("SELECT * FROM products WHERE id=?", (item["id"],)).fetchone()
                        if not row or not row["available"]:
                            return self.send_json(409, {"error": "A product in your cart is currently unavailable. Please refresh your cart."})
                        product = product_from_row(row)
                        subtotal = round(float(row["price"]) * item["quantity"], 2)
                        total += subtotal
                        quote.append({"id": row["id"], "name": row["name"], "quantity": item["quantity"], "price": row["price"], "subtotal": subtotal})
                return self.send_json(200, {"items": quote, "total": round(total, 2), "currency": "INR"})
            if path.startswith("/api/admin/"):
                session = self.require_admin(csrf=True)
                if not session: return
                data = self.read_json(MAX_UPLOAD_BYTES * 4 // 3 + 2048)
                if path == "/api/admin/categories":
                    name = require_text(data.get("name"), "Category", 80)
                    with db() as con:
                        try:
                            con.execute("INSERT INTO categories(name,created_at) VALUES(?,?)", (name, now()))
                        except sqlite3.IntegrityError:
                            return self.send_json(409, {"error": "That category already exists."})
                    return self.send_json(201, {"name": name})
                if path == "/api/admin/images":
                    encoded = data.get("data")
                    if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD_BYTES * 4 // 3 + 16):
                        return self.send_json(413, {"error": "Images must be 5 MB or smaller."})
                    try: blob = base64.b64decode(encoded, validate=True)
                    except Exception: return self.send_json(400, {"error": "Image upload is invalid."})
                    if not blob or len(blob) > MAX_UPLOAD_BYTES:
                        return self.send_json(413, {"error": "Images must be between 1 byte and 5 MB."})
                    signatures = [(b"\x89PNG\r\n\x1a\n", ".png"), (b"\xff\xd8\xff", ".jpg"), (b"RIFF", ".webp")]
                    extension = None
                    for signature, ext in signatures:
                        if blob.startswith(signature) and (ext != ".webp" or blob[8:12] == b"WEBP"):
                            extension = ext; break
                    if not extension: return self.send_json(400, {"error": "Use a PNG, JPEG, or WebP image."})
                    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
                    filename = f"{uuid.uuid4().hex}{extension}"
                    (UPLOAD_DIR / filename).write_bytes(blob)
                    return self.send_json(201, {"image": f"assets/uploads/{filename}"})
                if path == "/api/admin/products":
                    product = self.validate_product(data)
                    stamp = now()
                    with db() as con:
                        con.execute("BEGIN IMMEDIATE")
                        new_id = con.execute("SELECT next_id FROM catalog_sequence WHERE singleton=1").fetchone()[0]
                        con.execute("UPDATE catalog_sequence SET next_id=? WHERE singleton=1", (new_id + 1,))
                        product.update({"id": new_id, "createdAt": stamp, "updatedAt": stamp})
                        self.store_product(con, product, stamp, stamp)
                        con.execute("INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)", (product["category"], stamp))
                    return self.send_json(201, product)
                match = re.fullmatch(r"/api/admin/products/(\d+)/duplicate", path)
                if match:
                    source_id = int(match.group(1)); stamp = now()
                    with db() as con:
                        source = con.execute("SELECT * FROM products WHERE id=?", (source_id,)).fetchone()
                        if not source: return self.send_json(404, {"error": "Product not found."})
                        product = product_from_row(source)
                        con.execute("BEGIN IMMEDIATE")
                        new_id = con.execute("SELECT next_id FROM catalog_sequence WHERE singleton=1").fetchone()[0]
                        con.execute("UPDATE catalog_sequence SET next_id=? WHERE singleton=1", (new_id + 1,))
                        product.update({"id": new_id, "name": f"Copy of {product['name']}", "available": False, "stock": 0, "createdAt": stamp, "updatedAt": stamp})
                        self.store_product(con, product, stamp, stamp)
                    return self.send_json(201, product)
                return self.send_json(404, {"error": "Admin route not found."})
            return self.send_json(404, {"error": "Route not found."})
        except (ValueError, sqlite3.Error) as error:
            return self.send_json(400, {"error": str(error)})

    def validate_product(self, data: dict, existing: dict | None = None) -> dict:
        product = dict(existing or {})
        name = require_text(data.get("name", product.get("name")), "Product name", 120)
        category = require_text(data.get("category", product.get("category")), "Category", 80)
        try: price = float(data.get("price", product.get("price")))
        except (TypeError, ValueError): raise ValueError("Price must be a number.")
        if isinstance(data.get("price", product.get("price")), bool) or not math.isfinite(price) or price < 0:
            raise ValueError("Price must be a non-negative number.")
        description = require_text(data.get("description", product.get("description", "")), "Description", 1200, allow_empty=True)
        offer = require_text(data.get("offer", product.get("offer", "")), "Offer label", 80, allow_empty=True)
        image = valid_image_path(data.get("image", product.get("image", "")))
        available = data.get("available", product.get("available", True))
        if not isinstance(available, bool): raise ValueError("Availability must be selected.")
        brand = require_text(data.get("brand", product.get("brand", "")), "Brand", 80, allow_empty=True)
        subcategory = require_text(data.get("subcategory", product.get("subcategory", category)), "Subcategory", 80, allow_empty=True)
        with db() as con:
            if not con.execute("SELECT 1 FROM categories WHERE name=?", (category,)).fetchone():
                raise ValueError("Choose an existing category.")
        keywords = product.get("keywords") if isinstance(product.get("keywords"), list) else []
        terms = re.findall(r"[\w'-]+", f"{name} {brand} {category} {subcategory}", re.UNICODE)
        keywords = list(dict.fromkeys([*keywords, *(term.lower() for term in terms)]))[:80]
        product.update({"name": name, "brand": brand or name.split()[0], "category": category, "subcategory": subcategory or category, "keywords": keywords, "price": price, "stock": int(product.get("stock", 1 if available else 0) or (1 if available else 0)), "available": available, "featured": bool(product.get("featured", False)), "rating": float(product.get("rating", 0) or 0), "reviews": int(product.get("reviews", 0) or 0), "badge": str(product.get("badge", "")), "offer": offer, "image": image, "description": description})
        if not available: product["stock"] = int(product.get("stock", 0))
        return product

    @staticmethod
    def store_product(con: sqlite3.Connection, product: dict, created_at: str, updated_at: str) -> None:
        con.execute("INSERT INTO products(id,name,category,price,available,product_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", (product["id"], product["name"], product["category"], product["price"], int(product["available"]), json.dumps(product, ensure_ascii=False), created_at, updated_at))

    def do_PUT(self):
        path = urlparse(self.path).path
        session = self.require_admin(csrf=True)
        if not session: return
        try:
            data = self.read_json()
            if path == "/api/admin/prices":
                entries = data.get("prices")
                if not isinstance(entries, list) or not entries or len(entries) > 500:
                    return self.send_json(400, {"error": "Choose one or more prices to save."})
                seen = set(); parsed = []
                for entry in entries:
                    if not isinstance(entry, dict) or not isinstance(entry.get("id"), int) or isinstance(entry.get("price"), bool):
                        return self.send_json(400, {"error": "Each price update needs a product and numeric price."})
                    try: price = float(entry["price"])
                    except (TypeError, ValueError): return self.send_json(400, {"error": "Price must be numeric."})
                    if not math.isfinite(price) or price < 0: return self.send_json(400, {"error": "Price must be numeric and cannot be negative."})
                    if entry["id"] in seen: return self.send_json(400, {"error": "A product appears more than once in this update."})
                    seen.add(entry["id"]); parsed.append((entry["id"], price))
                stamp = now(); updated = []
                with db() as con:
                    current = {product_id: con.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone() for product_id, _ in parsed}
                    if any(row is None for row in current.values()):
                        return self.send_json(404, {"error": "A selected product no longer exists. Reload the price list."})
                    for product_id, price in parsed:
                        row = current[product_id]
                        product = product_from_row(row)
                        if float(row["price"]) != price:
                            old_price = float(row["price"]); product["price"] = price; product["updatedAt"] = stamp
                            con.execute("UPDATE products SET price=?,product_json=?,updated_at=? WHERE id=?", (price, json.dumps(product, ensure_ascii=False), stamp, product_id))
                            con.execute("INSERT INTO price_history(product_id,product_name,old_price,new_price,changed_at,changed_by) VALUES(?,?,?,?,?,?)", (product_id, product["name"], old_price, price, stamp, session["username"]))
                        updated.append(product)
                return self.send_json(200, {"updated": updated})
            product_match = re.fullmatch(r"/api/admin/products/(\d+)", path)
            availability_match = re.fullmatch(r"/api/admin/products/(\d+)/availability", path)
            category_match = re.fullmatch(r"/api/admin/categories/(.+)", path)
            if availability_match:
                product_id = int(availability_match.group(1))
                if not isinstance(data.get("available"), bool): return self.send_json(400, {"error": "Availability must be selected."})
                with db() as con:
                    row = con.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
                    if not row: return self.send_json(404, {"error": "Product not found."})
                    product = product_from_row(row); product["available"] = data["available"]
                    stamp = now(); product["updatedAt"] = stamp
                    con.execute("UPDATE products SET available=?,product_json=?,updated_at=? WHERE id=?", (int(data["available"]), json.dumps(product, ensure_ascii=False), stamp, product_id))
                return self.send_json(200, product)
            if product_match:
                product_id = int(product_match.group(1))
                with db() as con:
                    row = con.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
                    if not row: return self.send_json(404, {"error": "Product not found."})
                    old = product_from_row(row)
                    product = self.validate_product(data, old)
                    stamp = now(); product["updatedAt"] = stamp
                    con.execute("UPDATE products SET name=?,category=?,price=?,available=?,product_json=?,updated_at=? WHERE id=?", (product["name"], product["category"], product["price"], int(product["available"]), json.dumps(product, ensure_ascii=False), stamp, product_id))
                    if old["price"] != product["price"]:
                        con.execute("INSERT INTO price_history(product_id,product_name,old_price,new_price,changed_at,changed_by) VALUES(?,?,?,?,?,?)", (product_id, old["name"], old["price"], product["price"], stamp, session["username"]))
                    con.execute("INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)", (product["category"], stamp))
                return self.send_json(200, product)
            if category_match:
                old_name = unquote(category_match.group(1))
                new_name = require_text(data.get("name"), "Category", 80)
                with db() as con:
                    if con.execute("SELECT 1 FROM categories WHERE name=?", (new_name,)).fetchone() and old_name != new_name:
                        return self.send_json(409, {"error": "That category already exists."})
                    stamp = now()
                    con.execute("UPDATE categories SET name=? WHERE name=?", (new_name, old_name))
                    rows = con.execute("SELECT * FROM products WHERE category=?", (old_name,)).fetchall()
                    for row in rows:
                        product = product_from_row(row); product["category"] = new_name; product["subcategory"] = new_name if product.get("subcategory") == old_name else product.get("subcategory"); product["updatedAt"] = stamp
                        con.execute("UPDATE products SET category=?,product_json=?,updated_at=? WHERE id=?", (new_name, json.dumps(product, ensure_ascii=False), stamp, row["id"]))
                return self.send_json(200, {"name": new_name})
            return self.send_json(404, {"error": "Route not found."})
        except (ValueError, sqlite3.Error) as error:
            return self.send_json(400, {"error": str(error)})

    def do_PATCH(self):
        self.do_PUT()

    def do_DELETE(self):
        path = urlparse(self.path).path
        session = self.require_admin(csrf=True)
        if not session: return
        try:
            data = self.read_json() if int(self.headers.get("Content-Length", "0") or 0) else {}
            match = re.fullmatch(r"/api/admin/products/(\d+)", path)
            category_match = re.fullmatch(r"/api/admin/categories/(.+)", path)
            if match:
                product_id = int(match.group(1))
                with db() as con:
                    product = con.execute("SELECT name FROM products WHERE id=?", (product_id,)).fetchone()
                    if not product: return self.send_json(404, {"error": "Product not found."})
                    con.execute("DELETE FROM products WHERE id=?", (product_id,))
                return self.send_json(200, {"deleted": product["name"]})
            if category_match:
                category = unquote(category_match.group(1))
                with db() as con:
                    if con.execute("SELECT 1 FROM products WHERE category=? LIMIT 1", (category,)).fetchone():
                        return self.send_json(409, {"error": "Move products to another category before deleting this one."})
                    con.execute("DELETE FROM categories WHERE name=?", (category,))
                return self.send_json(200, {"deleted": category})
            return self.send_json(404, {"error": "Route not found."})
        except (ValueError, sqlite3.Error) as error:
            return self.send_json(400, {"error": str(error)})


def main() -> None:
    init_db()
    if "--init-admin" in sys.argv:
        create_first_admin()
        return
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Vinayak Superstore running at http://{HOST}:{PORT}")
    print("Open /admin to sign in. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
