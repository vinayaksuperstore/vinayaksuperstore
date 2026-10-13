# Keep the catalogue after Render restarts

The Render free service has a temporary local disk. This project can use a free hosted PostgreSQL database instead, so product, price, admin, price-history, and uploaded-image records live outside Render. The website still uses the same `/api` routes.

## One-time setup

1. Create a free PostgreSQL project at [Neon](https://neon.com/). The Free plan currently includes 1 GB of database storage per project ([plan details](https://neon.com/blog/neon-free-plan-1-gb-per-project)).
2. In Neon, open **Connect** and copy the PostgreSQL connection string. Keep it private; it contains a password.
3. Before copying data, make sure the local file `data/vinayak.sqlite3` contains the exact products and prices you want to keep. `migrate_to_postgres.py` copies that local catalogue and admin account. It refuses to copy into a database that already contains products.
4. Open PowerShell in this project folder and run:

   ```powershell
   $env:DATABASE_URL = Read-Host "Paste the connection string"
   $py = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
   & $py -m pip install -r requirements.txt
   & $py migrate_to_postgres.py
   ```

   Wait for the final `Copied ...` message. If the local catalogue is not the version you want to keep, stop here; do not copy it.

## Connect Render to the database

1. In Render, open the **vinayak-superstore-api** service.
2. Open **Settings**. Set **Build Command** to `pip install -r requirements.txt` and **Start Command** to `python server.py`.
3. Open **Environment** and add `DATABASE_URL`, using the same Neon connection string. Add or keep `HOST` as `0.0.0.0` and `COOKIE_SECURE` as `1`. Keep the existing `ALLOWED_ORIGINS` setting if you added one.
4. Save the settings and let Render deploy.
5. Sign in to `/admin`, change a product, and reload the page to confirm it saved.

Render's service will then read and write the hosted database. Uploaded images are stored in that database too. The migration carries over products, categories, price history, the admin password hash, and local uploaded images; you will need to sign in again after switching.

## What the migration does

- It does not modify or remove the local SQLite catalogue.
- It stops if the hosted database already contains products.
- It does not copy old login sessions.
- Do not post or send the Neon connection string in chat, GitHub, or a screenshot. Enter it only in the local PowerShell window and Render's private Environment settings.
