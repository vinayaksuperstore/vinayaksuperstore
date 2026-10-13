# Changelog

## v2.0 — Vinayak AI Shopping Assistant

### Added

- Added Vinayak AI, a personal shopping assistant that recommends products from the live store catalogue.
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
