#!/usr/bin/env python3
"""Stage only public storefront files for Netlify; never publish the backend or database."""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    for name in (
        "index.html",
        "style.css",
        "manifest.json",
        "robots.txt",
        "sitemap.xml",
        "sw.js",
    ):
        source = ROOT / name
        if source.is_file():
            shutil.copy2(source, DIST / name)

    for name in ("admin", "assets", "scripts", "styles"):
        source = ROOT / name
        if source.is_dir():
            shutil.copytree(
                source,
                DIST / name,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "uploads"),
            )


if __name__ == "__main__":
    main()
