# Verification

The production app passed 26 browser checks and five backup/hierarchy validation tests.

The browser checks ran in Chromium against the packaged production build. Offline checks disabled the browser network before reopening and editing the app. The repository-path test used a GitHub Pages style `/slate/` build.

- Workspace opens and initializes device storage
- Nested page, templates, editor and autosave
- Create flashcards and page-linked dated tasks
- Attach a file and index its text
- Reopening preserves page contents, nesting and favorites
- Global search finds text inside attachments
- Tasks retain completion state
- Flashcard answer and review scheduling
- Collection table and board share editable data
- Backup contains valid notes, versions, tasks, cards, collections and attachment bytes
- Backup restoration replaces workspace atomically
- Cold reload, writing and persistence work with network disabled
- Stored attachments open offline
- Mobile navigation and layout fit a 390-pixel screen
- No uncaught browser errors
- Slash commands accept keyboard selection; exam markers appear in Study
- Stable page links open target pages and create backlinks
- History restoration recovers earlier content and retains a recovery snapshot
- PDF text extraction runs locally and is searchable
- Both split editors save, and flashcards retain the correct source page
- Trash and restore retain page content and attached files
- A stale tab cannot silently overwrite newer saved notes
- Removing attachments also releases stored file bytes
- GitHub Pages subdirectory build opens
- Service worker and manifest stay within the repository path
- Repository-path app cold reloads offline

`npm run build`, `npm test`, and JavaScript syntax checking for the launcher passed. No uncaught browser errors occurred in the checked flows.

Windows/Linux installer binaries were not produced. The installed app is a browser PWA. Windows and Linux GUI installers and an actual deployment to your GitHub account were not tested or performed.
