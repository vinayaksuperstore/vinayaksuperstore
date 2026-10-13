# Vinayak Superstore admin setup

The storefront and admin panel now use a small same-origin Python service with a SQLite product catalogue. The first run copies the original 200 product records from `data/products.legacy-backup.json`, preserving product IDs, images, descriptions, categories, stock fields, and prices. The backup is kept intact.

## Start the site

Use Python 3.9 or newer from the project folder:

1. Create the first admin account: `python server.py --init-admin`
2. Choose a username and a private password of at least 12 characters when prompted. The password is hashed before it is stored; no credentials are in browser code.
3. Start the site: `python server.py`
4. Open `http://127.0.0.1:8000/` for the storefront or `http://127.0.0.1:8000/admin` for the admin panel.

### Windows Command Prompt

Change into the project folder (the `.lnk` on the Desktop is a shortcut, not a folder):

```bat
cd /d "C:\Users\RAJAN SHARMA\Documents\Codex\2026-10-08\VinayakSuperstore"
```

If Command Prompt says `python` is not recognized, use the Python runtime bundled with Codex:

```bat
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py --init-admin
```

After setting the admin username and password, start the website in that same window with:

```bat
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py
```

Keep the server window open while using the site. Visit `http://127.0.0.1:8000/admin` to manage products.

The SQLite catalogue is stored in `data/vinayak.sqlite3`. Uploaded product images are stored under `assets/uploads/`. Back up both locations when backing up the store.

## Hosting

This project previously consisted of static files, so it must now be hosted as a Python application rather than uploaded to a static-only host. Put the app behind HTTPS and a production reverse proxy, use a persistent disk for the SQLite file and uploaded images, and configure `HOST=127.0.0.1`, the provider's `PORT`, and `COOKIE_SECURE=1`. If the hosting provider requires binding the application to all interfaces, set `HOST=0.0.0.0`; HTTPS must still terminate at the provider or a reverse proxy. Never expose the local development server directly to the public internet.

For local development, the default host is `127.0.0.1` and the admin cookie is not marked `Secure` so HTTP localhost works. Production must use HTTPS and `COOKIE_SECURE=1`.

## Admin features

- `/admin` requires the server-side admin login.
- Product changes, price batches, category management, availability, and image uploads require an authenticated session and CSRF token.
- Price updates are recorded in `price_history`; deleted products' history remains available in the database.
- Customer checkout asks the server for a current quote before opening WhatsApp, so stale cart prices and unavailable items are rejected.
- The checkout in this project sends an order request through WhatsApp; it does not create or store orders, so there is no Orders dashboard.
- The admin panel does not include order processing or inventory counts because the original project has no order or inventory backend.

The catalogue contains the store owner's supplied price, name, offer, and availability updates. Prices that have not been supplied remain at their prior values; do not infer or apply prices for those products. Their prices can be entered later through Price Management.
