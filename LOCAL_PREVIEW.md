# Local preview

Start the storefront and checkout API from this project folder in PowerShell. The first launch creates an isolated database under `work/local-preview` and seeds it from `data/products.json`.

### VS Code Live Server compatibility

VS Code Live Server serves the storefront files but does not run this project's `/api/checkout/quote` and `/api/orders` endpoints. Product browsing may appear to work while checkout cannot verify prices or accept an order. For a complete checkout preview, start `server.py` below and open `http://127.0.0.1:8766/`; this serves the storefront and API together on one origin. Do not use Live Server for checkout testing.

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '8766'
$env:DATABASE_URL = ''
$env:VINAYAK_DB_PATH = Join-Path $PWD 'work/local-preview/vinayak.sqlite3'
$env:VINAYAK_UPLOAD_DIR = Join-Path $PWD 'work/local-preview/uploads'
python -B server.py
```

Open `http://127.0.0.1:8766/`. The server stays in the PowerShell window; press **Ctrl+C** to stop it. If `python` is not on PATH, use `py -3 -B server.py` instead. Use test details when trying checkout. Orders submitted here are stored only in this local database.

WhatsApp owner alerts are disabled in this local preview unless you explicitly configure Cloud API environment variables. Keep production credentials in Render only; do not use real owner alert credentials when placing local test orders.

To preview the admin Orders area, stop the server and run `server.py --init-admin` with the same environment values above. Choose a local admin username and password, then start `server.py` again and open `http://127.0.0.1:8766/admin`. The project copy does not include the original admin database or credentials.

The local preview does not place real orders, send WhatsApp messages automatically, or change the live website. Production order storage starts only after the updated server is deployed with a persistent database and the existing API routing is kept in place.

## Optional Android browser check on a private Wi-Fi network

The Codex browser preview cannot reproduce Android Chrome or the Google app. To test the local build on an Android phone connected to the same trusted Wi-Fi as this PC, stop the current preview and start a separate LAN-only test instance:



```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '8767'
$env:DATABASE_URL = ''
$env:VINAYAK_DB_PATH = Join-Path $PWD 'work/local-preview/vinayak-android-test.sqlite3'
$env:VINAYAK_UPLOAD_DIR = Join-Path $PWD 'work/local-preview/android-test-uploads'
python -B server.py
```

Run `ipconfig` on the PC and use its Wi-Fi adapter's IPv4 address in the phone browser, for example `http://192.168.1.20:8767/`. In Android Chrome and the Google app, open that address directly; then refresh, search, change categories, and add a product. Use fictitious customer details and do not place real orders. Stop the server with **Ctrl+C** when finished. Binding to `0.0.0.0` is only for this trusted local-network check; do not expose the development server to public networks or the internet.

This checks the Android browser experience with the local changes. It cannot verify tapping an indexed Google result for the live domain because the live site has not been changed; that exact path requires a staging or deployed build.
