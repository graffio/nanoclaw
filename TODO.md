# Backlog

- [ ] Convert host-side TypeScript (src/*.ts) to vanilla JavaScript. ~15+ files, all import each other so it's all-at-once. No runtime urgency (compiles once at build time) but aligns with JS-only policy.
- [ ] Test daily cron on next weekly update (probably Sat Mar 22): verify agent extracts holdings data from spreadsheet images, updates ticker dossiers, and writes holdings snapshot JSON. If it skips images, add a verification/completion check to the cron prompt.
