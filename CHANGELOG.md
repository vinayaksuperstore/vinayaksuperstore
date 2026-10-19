# Changelog

## v2.1 — Checkout and Product Loading Reliability (2026-10-19)

### Added

- Added customer details, order review, and confirmation steps to the existing cart checkout.
- Added server-side order storage with authoritative catalogue pricing, idempotent retries, authenticated admin order management, and private customer details.
- Added local preview and Android-on-private-Wi-Fi testing instructions.

### Improved

- Added product loading timeouts, a root-relative catalogue fallback, retry and error states, and image fallbacks.
- Improved cart synchronization, checkout accessibility, mobile layouts, and empty-cart behavior.
- Made the service worker network-only and updated its activation and root registration paths to avoid stale catalogue data and nested-path registration issues.
- Added order API integration tests and clarified that delivery charges and payment method require store confirmation until configured.
- Documented that VS Code Live Server serves static files only and added the API-backed local preview steps for checkout testing.
- Added a checkout error hint when the local static preview cannot reach the order API.

### Cart reliability

- Product additions now tolerate empty or malformed quote responses when a valid catalogue price is available; checkout still requires a fresh server quote.
- Explicit store rejections remain blocked, missing prices are not treated as zero, and error toasts use error styling instead of the success check mark.

## v2.0 — Vee Shopping Assistant

### Added

- Added Vee, your personal shopping assistant that recommends products from the live store catalogue.
- Added context-aware follow-ups for occasions, categories, budgets, quantities, alternatives and basket changes.
- Added product cards, proposed basket totals, remaining-budget details and quantity controls.
- Added an explicit add-to-cart action that checks the store's current price before changing the cart.
- Added session-scoped conversation history and a responsive, keyboard-accessible chat interface.

### Reliability

- Recommendations exclude unavailable products and products without a valid current price.
- Budget changes recalculate the proposed basket while preserving existing constraints.
- Dietary and serving details are only used where the catalogue provides supporting information; missing attributes are disclosed.
- Added 14 automated conversation and catalogue tests, exercised against the current 193-product catalogue.

## v1.1 — Stabilization

### Fixed

- Corrected the Grocery product filter key.
- Replaced the storefront photo fallback with the branded product placeholder.
- Repaired cart and wishlist rendering, including the missing wishlist item wrapper.
- Removed duplicate document execution of the service worker.

### Improved

- Added focus visibility, skip navigation, dialog semantics, motion safeguards and drawer focus return.
- Added native image lazy loading and async decoding for product imagery.
- Improved currency formatting, empty states and checkout copy.

### SEO and PWA

- Added basic social metadata, robots.txt, sitemap.xml and a deployment-safe PWA start URL.

### Known issues

- 170 catalog-specific product images still need to be supplied or licensed. The branded placeholder now displays until each asset is available.
- The sitemap domain is a placeholder and must be replaced with the production domain before launch.
