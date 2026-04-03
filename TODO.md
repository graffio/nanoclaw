# Backlog

- [x] Re-scrape existing posts to replace `../images/` local paths with CDN URLs. Done — 215 posts rescrapped, 3 edge cases remain.
- [ ] Verify agent vision-extracts image data from CDN URLs on next weekly update. The new flow downloads images to temp, extracts with vision, replaces the CDN link in the post with extracted text, and deletes the temp file.
