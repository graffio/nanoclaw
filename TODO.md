# Backlog

- [ ] Convert host-side TypeScript (src/*.ts) to vanilla JavaScript. ~15+ files, all import each other so it's all-at-once. No runtime urgency (compiles once at build time) but aligns with JS-only policy.
- [ ] Re-scrape existing posts to replace `../images/` local paths with CDN URLs. 175 posts still have old-style local image references. A full re-scrape will regenerate them with the new format. Can also delete local images from disk afterwards.
- [ ] Verify agent vision-extracts image data from CDN URLs on next weekly update. The new flow downloads images to temp, extracts with vision, replaces the CDN link in the post with extracted text, and deletes the temp file.
