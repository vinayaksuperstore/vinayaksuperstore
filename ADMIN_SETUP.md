# Vinayak Superstore admin setup

The storefront and admin panel use a small same-origin Python service with a SQLite product catalogue. On a fresh database, the server seeds the current catalogue from `data/products.json`; it falls back to `data/products.legacy-backup.json` only when the current snapshot is absent. Existing product databases are not overwritten.

## Start the site

Use Python 3.9 or newer from the project folder:

1. Create the first admin account: `python server.py --init-admin`
2. Choose a username and a private password of at least 12 characters when prompted. The password is hashed before it is stored; no credentials are in browser code.
3. Start the site: `python server.py`
4. Open `http://127.0.0.1:8000/` for the storefront or `http://127.0.0.1:8000/admin` for the admin panel.

### Windows Command Prompt

Change into this project folder (the `.lnk` on the Desktop is a shortcut, not a folder):

```bat
cd /d "C:\Users\RAJAN SHARMA\Documents\Codex\2026-10-19\vinayak-superstore-checkout-upgrade-product-loading"
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

## VS Code Live Server preview

VS Code Live Server serves static files and cannot run the product API. The storefront now falls back to `data/products.json` for catalogue browsing and Vee recommendations when that API is unavailable. This file is a snapshot of the current catalogue; admin edits and other server-backed features require the Python service above.

## Hosting

This project previously consisted of static files, so it must now be hosted as a Python application rather than uploaded to a static-only host. Put the app behind HTTPS and a production reverse proxy, use a persistent disk for the SQLite file and uploaded images, and configure `HOST=127.0.0.1`, the provider's `PORT`, and `COOKIE_SECURE=1`. If the hosting provider requires binding the application to all interfaces, set `HOST=0.0.0.0`; HTTPS must still terminate at the provider or a reverse proxy. Never expose the local development server directly to the public internet.

For local development, the default host is `127.0.0.1` and the admin cookie is not marked `Secure` so HTTP localhost works. Production must use HTTPS and `COOKIE_SECURE=1`.

## Admin features

- `/admin` requires the server-side admin login.
- Product changes, price batches, category management, availability, and image uploads require an authenticated session and CSRF token.
- Price updates are recorded in `price_history`; deleted products' history remains available in the database.
- Checkout asks the server to accept and store an order after the customer reviews the current server-priced items. The server creates the order ID, normalises the phone number, recalculates item prices, records status, and uses an idempotency key so a safe retry returns the same order.
- Accepted orders appear in the signed-in **Orders** area. Customer name, phone number, and delivery address are returned only to the customer who placed the order and authenticated admins; there is no public order lookup route.
- The website advertises free delivery above ₹500 within the store's service area, but the covered area is not configured in the project. Every accepted order leaves delivery eligibility and the final amount pending until an admin checks the address and confirms the delivery charge (enter ₹0 only when free delivery is confirmed). The storefront lists UPI, cards, and cash; no payment is taken at checkout, and the specific method remains to be confirmed with the customer.
- The confirmation offers an optional WhatsApp link containing only the order ID. It does not send customer details automatically. Set an order-data retention policy before production use.
- Orders are stored in the configured database. Use the persistent PostgreSQL setup below for production; SQLite on an ephemeral host can lose order records when its disk is replaced.

The catalogue contains the store owner's supplied price, name, offer, and availability updates. Prices that have not been supplied remain at their prior values; do not infer or apply prices for those products. Their prices can be entered later through Price Management.
