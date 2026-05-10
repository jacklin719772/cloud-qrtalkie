# Legacy Prototype Boundary

This folder hosts the temporary bridge for the existing static HTML prototype.

Current role:
- Render `#static-prototype` from `index.html`.
- Call `initPrototype()` from `app.js` once after mount.
- Preserve current UI behavior while feature modules are migrated.

Migration rule:
- Do not add new business logic here.
- Move new React work into feature folders such as `src/features/billing`.
- Keep this bridge only until the static template and `app.js` are fully replaced.
