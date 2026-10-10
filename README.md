# Slate

An offline personal workspace for notes, coursework, projects, tasks, and study cards, where your notes quiz you back.

**Notes work offline without an account or subscription.** In the desktop app, **Ask AI** lets you talk through your notes with Qwen (the default), Mistral, Gemini, Claude, ChatGPT (with your plan's sign-in), any OpenAI-compatible service, or a model running on your own computer with Ollama. The hosted app includes a copy-and-paste workflow.

![Slate workspace preview](preview.png)

## Start using it

Open the hosted app: https://owuorbruce.github.io/myself-/

### Windows desktop app

[Download Slate-Setup.exe](https://github.com/owuorbruce/myself-/releases/latest/download/Slate-Setup.exe).

1. Export a workspace backup from your browser copy if you want to keep those notes.
2. Close any old Slate command/launcher window.
3. Run **Slate-Setup.exe**, then open **Slate** from your desktop or Start menu.
4. Restore your backup in **Settings & backups**. The first-run banner explains this move.

The installer includes its own runtime. Node.js, a command window and a browser address are not required. Notes stay in the app's own local profile; they are separate from Chrome/Edge website storage. Your saved ChatGPT connection and AI provider keys can be reused because they stay in the protected user directory (`~/.slate`). ChatGPT sign-in opens your normal browser and replies appear back in Slate.

Closing the window saves pending workspace edits first. If saving fails, Slate asks you to return and export your work or explicitly close anyway. App updates preserve the workspace profile and refresh only application caches. Uninstalling does not intentionally delete your notes, but keep regular backups.

The current installer is unsigned. Use **Help → Download updates** for later releases. Windows x64 is the packaged target; other platforms can use the browser/source launcher below.

### Browser/source archive

The ZIP includes the source and a ready-built `dist/` folder. Unzip the entire folder first.

### Run the source archive on Windows, Linux or macOS

1. Install **Node.js 22.13 or newer** if it is not already installed: https://nodejs.org/
2. On Windows, double-click **start-slate.cmd**. On Linux, run `sh start-slate.sh` from the Slate folder. On macOS, run `node run-slate.mjs`.
3. Your browser opens **http://localhost:4173/**. Keep the launcher window open while you use Slate.
4. Use the browser menu to install Slate as an app. Chrome and Edge support desktop installation; browser options vary.

The prebuilt copy runs without `npm install` and without an internet connection. After installation and caching, the app also reopens offline. The local launcher binds only to your computer's loopback interface.

Always use the same address, **http://localhost:4173/**, for your local workspace. `127.0.0.1`, another port, another browser, or a GitHub Pages URL uses a different workspace. Export and restore a backup when moving between them.

### Host on your GitHub account

1. Create a GitHub repository, for example **slate**.
2. Upload the **contents** of this folder into the repository root, including `.github/workflows/pages.yml`, `package.json`, `package-lock.json`, and `src/`.
3. Use `main` as the default branch. If you use another branch, edit the workflow's branch name.
4. In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
5. Open **Actions** and run **Deploy Slate to GitHub Pages**, or push a commit to `main`.
6. Open the URL reported by the deployment. Visit it online once, then install it from your browser.

The workflow detects the GitHub Pages base path, builds Slate, runs the validation tests, and publishes only the app files. It supports project repositories, account Pages repositories, and configured custom domains.

By default, notes and attachments stay in this browser's IndexedDB storage. GitHub Pages distributes only the app code. If you enable optional sync, Slate also uploads notes and attachment bytes to the private GitHub repository you choose.

GitHub setup documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## What you can do

| Area         | Features                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Writing      | Rich text, headings, bold, italic, underline, highlights, lists, checklists, quotes, callouts, code blocks, tables, images, links, dividers  |
| Organization | Nested pages, drag pages into other pages, move a page using its location selector, favorites, tags, child pages, inbox capture              |
| Navigation   | Search and command menu, page tabs, split view with two editors, outline, focus mode, backlinks                                              |
| Collections  | Editable custom fields: text, number, date, checkbox, select, URL; table, board, calendar agenda, list, gallery; assignment tracker template |
| Tasks        | Dedicated tasks with due dates, priority, and source pages; aggregated checklists from notes                                                 |
| Interactive  | Toggles that open and close (and quiz you in Study), fill-in-the-blanks, label-the-image diagrams with green / amber / red feedback           |
| Teach me     | Turns any page into small teach-then-quiz bites with hearts, XP, pop quizzes and retries of what you missed                                  |
| Studying     | Daily 5-minute review, weak-spot tracking, study streak, spaced repetition for flashcards and quiz blocks, exam / definition markers          |
| Files        | Local attachments, image insertion, PDF and image preview, text/PDF attachment search, offline OCR for scans and photos                      |
| Sync         | Optional sync between phone and laptop through a private GitHub repository you own, with conflict copies                                      |
| Recovery     | Automatic snapshots, manual snapshots, restore history, trash and restore pages, full ZIP backup and restore                                 |
| Portability  | Notion export import, Markdown export and import (tables, `{{blanks}}`), structured JSON backup, attachment files included                   |
| Appearance   | Match my device, light, dark, sepia (moon button in the top bar); sans serif or serif editor; wide layout                                     |
| AI           | Ask AI chat with Qwen, Mistral, Gemini, Claude, ChatGPT, OpenAI-compatible services and local Ollama models; proposed page edits with Apply / Undo; quizzes from your notes |
| Offline      | Notes, search, collections, checklists, tasks, flashcards, existing attachments, and backups                                                 |

## Learn by doing

Slate is built for people who'd rather tap than read a wall of text.

- **Toggles.** Type `>` and a space at the start of a line, or `/toggle`, or press the ▸ toolbar button. Write a one-line summary, then anything underneath: text, lists, images, even other toggles. Click the arrow to open or close it. Each device remembers which toggles you left open. Quotes now start with `"` and a space, as in Notion.
- **Toggles in Study.** A toggle with a summary and some text inside becomes a review question: the summary is the prompt and the content is the answer. You grade yourself in Study, not in the note. A toggle that only holds other toggles works like a section, and the toggles inside it become the questions.
- **Older Tap to Learn blocks** turn into toggles automatically when a page loads, a backup is restored or synced notes arrive. The question becomes the summary, the answer becomes the content, and their review history carries over.
- **Fill in the blank.** Select a word and press the blank button in the toolbar, or type `/blank`. Type your guess into the gap and press Enter. Green is right, amber is a near miss, red is wrong. Separate accepted answers with `|`, like `osteoclasts|osteoclast`.
- **Label the image.** Type `/label` and pick a diagram or lab slide. Drag boxes over its labels and type each answer. Press **Done**, then fill in the boxes and press **Check**. **Retry mistakes** clears only the wrong ones.
- **Teach me.** Press **Teach me** on any page. Slate splits it into sections (by heading) and small bites, quizzes you right after each bite, gives pop quizzes every few sections, and brings back what you miss. Your blanks, toggles, labelled images and **bold key terms** become the questions.
- **Study → Today.** A short daily review that puts your weak spots first, then anything due. Answer one question a day to keep your streak.
- **Study → Weak spots.** Everything you've missed, worst first, with a button to practise just those.

Open **School → Interactive notes: example** in a new workspace, or press **Add an example page** in Study, to try it.

## A useful first session

- Open **School** and create a child page for a course.
- Create a **Class notes** page inside it.
- Type `/exam` on an empty line and choose **Exam marker** to flag a key idea.
- Open **Study → Marked material** to collect your marked concepts.
- Create a flashcard from a selection using **Flashcard** in the editor footer.
- Create a dated task using **Task** in the footer.
- Open **Collections**, create an assignment tracker, then add rows and choose a table or board view.
- Export a workspace backup in **Settings & backups**.

Starter pages contain no real assignments or deadlines. Rename or remove them as you wish.

## Sync between your phone and laptop

Sync is optional and uses a private GitHub repository you own, so there is still no Slate server.

1. Create a **private** repository on GitHub, for example `slate-notes`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new). Under **Repository access** choose **Only select repositories** and pick that repository. Under **Permissions → Contents** choose **Read and write**.
3. In Slate open **Settings & backups → Sync between your devices**, enter `your-name/slate-notes` and the token, and press **Connect and sync**.
4. Do the same on your other device. A fresh device takes your synced notes instead of adding a second set of starter pages.

Slate syncs when it opens, about 20 seconds after you edit, every 5 minutes, and when you switch away. The cloud button in the top bar syncs right away and shows the status. If the same page was edited on both devices before syncing, both versions are kept and the other one is named "(from other device)". Permanent deletions sync too.

Update Slate on every device you sync before syncing toggles: older versions of Slate can't read them and stop syncing until they're updated.

The token is stored only in that browser's device storage. It is never put in backups or in the synced copy. Slate refuses to sync to a public repository.

## Import from Notion

In Notion, export with **Markdown & CSV** and **Include subpages** (Settings → Workspace → Export, or a page's ⋯ menu → Export). In Slate open **Settings & backups → Import a Notion export (.zip)**.

Pages keep their nesting, images, tables, callouts, checklists and links between pages. Toggles stay toggles, including toggles inside toggles. A Notion toggle heading becomes a heading with its content underneath, so Teach me still splits the page into sections. Slides embedded as HTML files become images. Other files become attachments. Databases become Collections, and their row pages are imported as pages. Everything lands under a page called **Imported from Notion**. Files over 25 MB are skipped.

## Add pages from a Slate file

**Settings & backups → Add pages from a Slate file** adds the pages in a Slate backup ZIP or page pack to your workspace without replacing anything. Pages in a pack can name a page to go inside (for example the Lab 2 page), and they're nested there when it exists.

## Read text in scans and photos

When you attach a photo or a scanned PDF, Slate reads the printed text on your device and makes it searchable. Use **Read text** / **Text** on an attachment to see it and **Put this text in the page**. Turn automatic reading off in Settings if you prefer.

The text reader (about 11 MB) downloads the first time it's used, then works offline. **Download text reading for offline use** in Settings fetches it ahead of time. It reads English printed text; handwriting is hit and miss.

## Ask AI

Open **✦ Ask AI** on any page (or select text first). Type in the box at the bottom: **Enter** sends, **Shift + Enter** starts a new line. The small **Sending:** line above the box shows exactly which notes go to the AI. Tap it to choose this page, this page and its subpages, the selected text, your exam-marked material, specific pages, or no notes. Pages you name in a message are added to it.

The picker inside the box lists every connected AI's models, grouped by provider (**Qwen › qwen-plus**, **Mistral › …**, **Qwen (local) › qwen3.5:4b**). Model lists come from each provider, with **Reload** if one fails. Slate remembers your last pick; switching mid-conversation keeps the conversation. New conversations start on **Qwen** until you pick something else.

### Connect an AI

Open **Settings & backups → AI providers**:

| Provider | What you need |
| --- | --- |
| **Qwen** (default) | An Alibaba Cloud Model Studio API key. Choose its region: International (Singapore) is the default, then US (Virginia), China (Beijing) and China (Hong Kong). Keys only work with their own region's address, and you can paste a workspace address (for example `https://<workspace>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`) instead. |
| **Mistral**, **Gemini** (Google AI API), **Claude** (Anthropic API) | An API key from each provider. |
| **ChatGPT** | Your ChatGPT plan through OpenAI's [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source), unchanged: choose **Continue with ChatGPT** and allow plan usage. No API key; eligible Plus or Pro accounts only. |
| **OpenAI-compatible** | A name, address and key. Presets: OpenRouter, Groq, Cerebras, GitHub Models and NVIDIA NIM. Add as many as you like. |
| **Ollama** | Nothing: install [Ollama](https://ollama.com/download) and Slate finds it at `http://localhost:11434`. Run `ollama pull qwen3.5:4b` (or `qwen3.5:9b`) for **Qwen (local)**, the model Slate uses when you're offline. |

Keys are kept by the Slate helper on your computer in `~/.slate/ai/providers.json` (or `SLATE_AI_DIR`), next to the ChatGPT sign-in in `~/.slate/chatgpt`, outside your workspace and backups, with the same owner-only permissions. They're never shown to the page again or sent anywhere except their own provider's address, and Slate refuses redirects. Each provider has one key; Slate never switches between keys to get around limits. The files aren't encrypted, so don't share them.

### Working with your notes

Models that can call tools can search and read the shared pages and propose changes: a new page, an addition to a page, a rewrite or a task. Each proposal appears in the chat as a preview (the new page, or before and after) with **Apply** and **Discard**. Nothing is written until you press **Apply**; a snapshot is kept first, and **Undo** puts things back (a page it created goes to Trash). Several proposals in one reply are applied or discarded one by one. There's no way for the AI to delete pages.

Ask it to **quiz you** on a page, a folder or your exam-marked material: it asks one question at a time from those notes, then shows whether you were right, what was missing and the source page. At the end you get a score, and **Add to flashcards** puts any question you missed into Study's review schedule. **Save as new note**, **Copy** and **Add these flashcards** work the same with every provider.

Models that can't call tools are marked **answers only** in the picker and simply answer. If a model refuses tools the first time, Slate remembers that on this device. **Settings → AI providers → Check tool calling** makes one tiny real request to test a model.

### Limits and offline

If a provider says you've hit its rate limit, Slate shows when to try again and keeps your message in the box. It doesn't retry by itself. Offline, the picker shows only models on this computer and says that online AIs need internet; if no local model is set up, sending is turned off. Everything else in Slate keeps working offline.

AI needs the desktop app or the source launcher, which run the local helper. The hosted GitHub Pages version offers **Copy prompt** instead. Only what you send (your message, the conversation so far and the notes on the **Sending** line) goes to the provider you picked. Slate does not import your provider-side conversations or memory.

## Connect an AI app (MCP)

Like Notion's MCP server, Slate can let Claude, ChatGPT and other AI apps work with your notes. They get the same tools as Ask AI:

| Tool | What it does |
| --- | --- |
| `search_pages(query)` | Matching pages with id, title, path and a snippet |
| `list_pages(parent_id?)` | The page tree, a level at a time |
| `get_page(id)` | Title and content as Markdown (toggles as `<details>`) |
| `create_page(title, markdown, parent_id?)` | A new page, using Slate's Markdown importer |
| `update_page(id, markdown, mode)` | `append` to a page or `replace` it; the previous version stays in Page history |
| `list_tasks(status?)`, `create_task(title, due?, page_id?)` | Tasks |
| `list_flashcards(page_id?)` | Study flashcards |

There are no delete tools. It's off by default: turn it on in **Settings & backups → Connect an AI app**.

### On this computer: Claude Desktop and Claude Code

The Slate desktop app serves MCP at `http://127.0.0.1:4173/mcp` while it's open. It answers only apps on this computer that send the access token shown in Settings (Regenerate makes a new one), and refuses web pages: requests with a browser `Origin`, or for any host name other than `127.0.0.1`/`localhost`, are rejected. Calls run inside the Slate window through the same save queue, snapshots and sync bookkeeping as the editor, so a change an AI app makes is saved, synced and undoable like your own. If Slate isn't open, apps can't connect; if it's still loading, they're told to open Slate first.

- **Claude Code:** `claude mcp add --transport http slate http://127.0.0.1:4173/mcp --header "Authorization: Bearer <token>"` (Settings shows it with your token filled in).
- **Claude Desktop:** Settings shows a `claude_desktop_config.json` entry that uses `mcp-remote` (needs Node.js). Paste it under **Settings → Developer → Edit Config** and restart Claude Desktop.

Settings lists the recent calls on this computer: tool names and times only, never content.

### From anywhere: claude.ai, ChatGPT developer mode and phones

These apps can only reach a public HTTPS server with OAuth sign-in. `mcp-remote/` is a small Cloudflare Worker that works with your **private sync repository** through the GitHub API, in exactly the format Slate syncs, so its changes arrive on your next sync. When Slate syncs at the same moment, it combines the two with Slate's own sync merge, so a page changed in both places keeps both versions. It supports OAuth 2.1 with dynamic client registration (what claude.ai and ChatGPT expect), and only your GitHub account can sign in. Its GitHub token is a Cloudflare secret, never in the repository or in replies, and it refuses public repositories as sync does.

Follow [mcp-remote/DEPLOY.md](mcp-remote/DEPLOY.md) to set it up; it's written for someone who hasn't used Cloudflare before. Then paste its address into **Settings → Connect an AI app** for the claude.ai and ChatGPT steps.

## Offline and storage

Slate uses IndexedDB for workspace records and attachment blobs, and a service worker to cache its complete application bundle. There are no remote fonts, CDNs, tracking scripts, or required servers in the note-taking workflow. Text extraction from digital PDFs and OCR of scans and photos also run locally.

Each page, its history, and the extracted text of each attachment are stored as separate records, so typing only rewrites the page you're editing. Workspaces from the first version of Slate are converted automatically the first time the new version opens.

After the first successful visit, the app shows **Offline ready** when its cache is installed. Test your own browser by turning off the network, closing and reopening Slate, and editing a note.

Browser storage is finite and can be removed by clearing site data or deleting a browser profile. Use **Request persistent storage** and export regular backups. Persistent storage requests are subject to the browser's decision. Backups are ordinary unencrypted ZIP files; store them wherever you keep your private documents.

Only one tab should edit a workspace at a time. Saves check a revision number so a stale tab cannot silently overwrite another tab. If you see a save conflict, export your unsaved work and reload before editing further.

## Reliability

- Connecting sync always keeps existing notes, including new and imported notes. Starter pages may remain alongside remote notes.
- Sync uses the last successful snapshot to merge tasks, cards and collection rows independently. Conflicting edits are retained as copies.
- Only exact answers or explicit `|` alternatives pass automatically; close spellings are hints and count as missed until corrected or explicitly self-approved. Numeric signs and decimal points are preserved.
- Reviews use the current blank answers and prompts. Deleted blanks and changed automatic questions leave the review queue.
- Restoring a backup marks it for sync and records deletions of replaced records. Changes made on another device can still be preserved as conflict copies.
- Missing, incomplete or failed attachment transfers stop sync and show an error before publishing the workspace.

## History and backups

- Changes autosave shortly after you edit; **Ctrl / Cmd + S** flushes immediately.
- Editing creates a snapshot of the previous version, at most once every five minutes.
- Each page keeps its most recent 30 snapshots. Use **Save a snapshot now** before a major rewrite.
- Trash retains pages and children until permanent deletion.
- A full backup includes active and trashed pages, versions, tasks, cards, collection data, settings, and attachment bytes.
- Restoring validates structure and references before changing anything, then replaces workspace and files in one IndexedDB transaction.
- Restore is a **replacement**, rather than a merge. Export your current workspace first if you need to keep it.

Backup layout:

```text
workspace.json           authoritative structured workspace
pages/<page-id>.md        portable text copies of pages
attachments/<file-id>    original attachment bytes
```

`workspace.json` retains attachment names and types. Internal filenames use stable IDs so duplicate titles and filenames cannot overwrite each other.

## Keyboard shortcuts

| Action              | Shortcut                                        |
| ------------------- | ----------------------------------------------- |
| Search and commands | Ctrl / Cmd + K                                  |
| New page            | Ctrl / Cmd + N                                  |
| Save immediately    | Ctrl / Cmd + S                                  |
| Focus mode          | Ctrl / Cmd + Shift + F                          |
| Insert block        | Type `/` at the beginning of an empty paragraph |
| Check a blank       | Enter                                           |
| Close a dialog      | Escape                                          |

Some browsers reserve new-window shortcuts; the visible New page button is always available.

## Develop or rebuild

```bash
npm ci
npm run dev
```

For a production build:

```bash
npm test
npm run build
node run-slate.mjs
```

`npm run build` generates an offline-capable app and service worker. Development mode is for source editing; test offline behavior against the production build.

Set `VITE_BASE_PATH=/your-repository/` while building if you serve a prebuilt copy at a subdirectory. The provided GitHub workflow sets this automatically. For local use, the default `./` base works.

For desktop development and Windows packaging:

```bash
npm run build
npm run desktop
npm run package:windows
```

The Windows release workflow installs and launches the actual installer output twice to check save-on-close and persisted notes before publishing the download. Build dependencies are pinned; they are not needed by the installed app.

### Structure

- `src/App.tsx`: workspace UI, page navigation, tasks, study, backups, save queue.
- `src/Editor.tsx`: Tiptap editor and slash commands.
- `src/blocks.tsx`, `src/toggle-view.ts`: toggle, fill-in-the-blank and label-the-image editor blocks.
- `src/toggle.mjs`: toggle helpers for Study and the conversion of older Tap to Learn blocks.
- `src/Learn.tsx`, `src/lesson.ts`: Teach-me mode and the review session.
- `src/study.ts`, `src/grading.mjs`: answer grading, spaced repetition, weak spots and streaks.
- `src/sync.ts`, `src/sync-merge.mjs`: GitHub sync and merging between devices.
- `src/notion.ts`: Notion export importer.
- `src/ocr.ts`: offline text recognition (Tesseract), served from `ocr/`.
- `src/Collections.tsx`: collection fields and shared views.
- `src/storage.ts`: IndexedDB storage split by page, revision checks, attachment IO, export/restore, migration.
- `src/validation.mjs`: backup and hierarchy validation.
- `src/extensions.ts`: custom callout and page-link nodes.
- `src/markdown.ts`: Markdown importer.
- `src/pdf.ts`: lazy-loaded local PDF text extraction.
- `vite.config.ts`: app build, manifest, full offline caching.
- `.github/workflows/pages.yml`: GitHub Pages deployment.
- `.github/workflows/desktop.yml`: Windows build, installed-app checks and verified release download.
- `desktop/`: Electron main process, restricted preload bridge, sign-in handoff and package checks.
- `electron-builder.config.cjs`: bundled runtime and per-user Windows installer.
- `run-slate.mjs`: dependency-free localhost launcher for the prebuilt app and the AI helper.
- `server/chatgpt-auth.mjs`, `server/chatgpt-router.mjs`: local OAuth, credential storage, model catalog and response streaming.
- `server/ai/`: AI providers (one file each in `server/ai/providers/`), key storage and the `/api/ai` routes.
- `src/AIChat.tsx`, `src/ai.ts`, `src/ai-catalog.ts`: the Ask AI panel, its client and the model picker.
- `src/AISettings.tsx`, `src/ChatGPTUI.tsx`, `src/chatgpt.ts`: AI provider settings and the ChatGPT sign-in.
- `src/note-tools.mjs`, `src/doc-markdown.mjs`: the note tools shared by Ask AI and MCP, and pages as Markdown.
- `server/mcp/`: the MCP server (`core.mjs`, shared with the Worker) and the local `/mcp` endpoint; `server/vendor/mcp-sdk.mjs` is the official MCP SDK bundled by `npm run bundle:mcp`, so the launcher needs no `npm install`.
- `desktop/mcp-bridge.mjs`, `src/ConnectAIApp.tsx`: hands MCP calls to the Slate window, and the Connect an AI app settings.
- `mcp-remote/`: the hosted MCP server for Cloudflare Workers, with [DEPLOY.md](mcp-remote/DEPLOY.md).

## Current boundaries

This version is a personal workspace. It has no real-time collaboration, a packaged Linux/macOS installer, encrypted storage, collection formulas/relations, handwriting recognition, semantic/vector search, or unattended AI execution (AI apps act only when you ask them to, and only through the tools above). Windows has a desktop installer; the browser version can also be installed as a PWA. Sync needs a GitHub account and a private repository.

Calendar is a date-grouped agenda view. Reviews use an SM-2 style spaced repetition schedule rather than a full Anki/FSRS engine. Teach me builds questions from your own notes; it doesn't write explanations of its own. Markdown import covers headings, basic formatting, lists, checklists, quotes, links, fenced code and `<details><summary>…</summary>…</details>` toggles (which is also how toggles are exported); more elaborate Markdown constructs are kept as text. Imported remote images are not fetched automatically.

Attachment limit: 25 MB each. Inline image limit: under 5 MB. PDF indexing: up to 300 pages and 1 million text characters; larger PDFs remain attached without full indexing. Backup restore: under 200 MB compressed and total attachment bytes. Structured backup text is limited to 30 MB. These are client-side guardrails, not paid credits.

## License

The project code is released under the MIT License. Dependencies keep their own licenses.

