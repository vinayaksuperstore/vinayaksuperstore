#!/usr/bin/env python3
"""Copy the current SQLite catalogue into an empty hosted PostgreSQL database."""

import os
import sqlite3
import sys
import mimetypes
from pathlib import Path

if not os.environ.get("DATABASE_URL", "").strip():
    raise SystemExit("Set DATABASE_URL to your hosted database connection string first.")

import server


source_path = Path(sys.argv[1]) if len(sys.argv) > 1 else server.DB_PATH
if not source_path.is_file():
    raise SystemExit(f"Could not find the local catalogue: {source_path}")

server.init_db(seed_legacy=False)
with server.db() as target:
    if target.execute("SELECT COUNT(*) FROM products").fetchone()[0]:
        raise SystemExit("The hosted database already has products. No data was changed.")

with sqlite3.connect(source_path) as source:
    source.row_factory = sqlite3.Row
    products = source.execute("SELECT * FROM products ORDER BY id").fetchall()
    categories = source.execute("SELECT * FROM categories ORDER BY name").fetchall()
    history = source.execute("SELECT * FROM price_history ORDER BY id").fetchall()
    admins = source.execute("SELECT * FROM admin_users ORDER BY username").fetchall()
    sequence = source.execute("SELECT next_id FROM catalog_sequence WHERE singleton=1").fetchone()
images = []
if server.UPLOAD_DIR.is_dir():
    for image_path in server.UPLOAD_DIR.iterdir():
        if image_path.is_file() and image_path.suffix.lower() in {".png", ".jpg", ".webp"}:
            images.append((image_path.name, image_path.read_bytes(), mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"))

if not products:
    raise SystemExit("The local catalogue is empty. No data was copied.")

with server.db() as target:
    for row in categories:
        target.execute("INSERT INTO categories(name,created_at) VALUES(?,?)", (row["name"], row["created_at"]))
    for row in products:
        target.execute(
            "INSERT INTO products(id,name,category,price,available,product_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            tuple(row[key] for key in ("id", "name", "category", "price", "available", "product_json", "created_at", "updated_at")),
        )
    for row in history:
        target.execute(
            "INSERT INTO price_history(id,product_id,product_name,old_price,new_price,changed_at,changed_by) VALUES(?,?,?,?,?,?,?)",
            tuple(row[key] for key in ("id", "product_id", "product_name", "old_price", "new_price", "changed_at", "changed_by")),
        )
    for row in admins:
        target.execute(
            "INSERT INTO admin_users(username,password_hash,salt,created_at) VALUES(?,?,?,?)",
            tuple(row[key] for key in ("username", "password_hash", "salt", "created_at")),
        )
    for filename, image_data, content_type in images:
        target.execute("INSERT INTO product_images(filename,image_data,content_type,created_at) VALUES(?,?,?,?)", (filename, image_data, content_type, server.now()))
    next_id = sequence["next_id"] if sequence else max(row["id"] for row in products) + 1
    target.execute("UPDATE catalog_sequence SET next_id=? WHERE singleton=1", (next_id,))
    target.execute("SELECT setval(pg_get_serial_sequence('price_history','id'), COALESCE((SELECT MAX(id) FROM price_history), 1), true)")

print(f"Copied {len(products)} products, {len(categories)} categories, {len(history)} price-history entries, {len(admins)} admin account(s), and {len(images)} uploaded image(s).")
print("The original SQLite catalogue was not changed. Sign-in sessions were intentionally not copied.")
