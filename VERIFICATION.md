# Verification

Version 2 (interactive notes, Teach me, study tracking, split storage, sync, Notion import, OCR) passed 12 Node tests and 55 browser checks.

The browser checks ran in Chromium against the packaged production build served by `run-slate.mjs`.

## Node tests (`npm test`)

- Backup and hierarchy validation, including the new blocks and study data
- Answer grading: right, near miss, wrong, alternatives and plurals
- Spaced repetition intervals and streak counting across days
- Sync merge: newer page wins, both-sides edits keep a copy, deletions stick, orphaned pages are re-parented, inputs aren't modified
- Edits made while a sync is running are kept

## Interactive notes and studying

- Top-bar theme button switches light and dark; "Match my device" follows the system
- Fill-in-the-blank grades right / close / wrong; Tap to Learn reveals and records "Got it" / "Not yet"
- Slash menu and toolbar insert Tap to Learn, blanks (from a selection) and labelled images
- Label the image: drawing boxes, checking, the score, and Retry mistakes clearing only wrong boxes
- Teach me runs a whole lesson: teach cards, typed and self-graded questions, hearts, retries capped at two, finish screen with weak spots
- Teach me asks about labelled-image boxes
- Study shows the streak, today's review and weak spots; weak-spot practice starts
- Study history and edits survive reloads
- Inserting a file or text while a block is selected adds it after the block instead of replacing it

## Storage, backups and offline

- A workspace created by the previous version opens in this one with its pages intact and is converted to split storage (version 2, page content no longer in the main record)
- Markdown export keeps blanks as `{{answer}}` and Tap to Learn as `**Q: …**`
- Backup ZIP export, permanent delete, and restore bring back pages, blocks and study history
- After the app is cached: opens offline, Teach me works offline, offline edits are saved

## Files, import and sync

- OCR reads an attached image, the text becomes searchable and can be put into the page
- Notion export (nested ZIP with a wrapper folder): pages and nesting, inline image, table, callout, page links, `{{blank}}`, attached file, database to Collection
- Sync against a simulated GitHub API with two browser profiles: bad token message, first upload, fresh device takes synced notes without duplicate starter pages, edits travel both ways, a both-sides edit keeps a "(from other device)" copy, permanent deletes sync and don't come back
- Phone width (390 px): no sideways scrolling; Teach me and dark mode render

No uncaught browser errors occurred in the checked flows.

## Not tested

Sync was tested against a simulated GitHub API, not a real repository. Windows/Linux installer binaries were not produced; the installed app is a browser PWA.
