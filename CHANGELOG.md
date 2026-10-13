# Changelog

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
