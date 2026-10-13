"""Run the conversation tests against the current SQLite product catalogue."""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "vinayak.sqlite3"
TEST_PATH = ROOT / "tests" / "vinayak-ai.test.cjs"


def live_catalogue() -> list[dict]:
    connection = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True)
    try:
        rows = connection.execute("SELECT id,name,category,price,available,product_json FROM products ORDER BY id").fetchall()
    finally:
        connection.close()
    catalogue = []
    for product_id, name, category, price, available, product_json in rows:
        product = json.loads(product_json)
        product.update({
            "id": product_id,
            "name": name,
            "category": category,
            "price": price,
            "available": bool(available),
        })
        catalogue.append(product)
    return catalogue


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("Node.js was not found on PATH.", file=sys.stderr)
        return 2
    catalogue = live_catalogue()
    if not catalogue:
        print("The live product catalogue is empty.", file=sys.stderr)
        return 2
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as temporary:
        json.dump(catalogue, temporary, ensure_ascii=False)
        catalog_file = Path(temporary.name)
    env = os.environ.copy()
    env["VINAYAK_TEST_CATALOG"] = str(catalog_file)
    try:
        result = subprocess.run([node, "--test", str(TEST_PATH)], cwd=ROOT, env=env, check=False)
        print(f"Conversation tests used {len(catalogue)} products from data/vinayak.sqlite3.")
        return result.returncode
    finally:
        catalog_file.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
