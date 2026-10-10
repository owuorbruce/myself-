# Put Slate's MCP server online (Cloudflare, free)

This lets **claude.ai**, **ChatGPT developer mode** and AI apps on your phone read and add to your Slate notes. Those apps can only reach a public HTTPS server you sign in to, so this guide puts a small server on Cloudflare Workers. It works with the **private GitHub repository Slate already syncs to**: changes it makes show up in Slate after the next sync, and if you edit the same page in Slate before syncing, both versions are kept.

You only do this once. It takes about 20 minutes and costs nothing on Cloudflare's free plan.

## Before you start

- **Slate sync is on.** In Slate, **Settings & backups → Sync between your devices** is connected to a private repository (for example `you/slate-notes`), and you've synced at least once.
- **Node.js 22 or newer** is installed: <https://nodejs.org/>. Check by running `node --version` in a terminal.
- You have the Slate source folder (the one with `mcp-remote/` in it).

Throughout this guide, "terminal" means **PowerShell** on Windows, or **Terminal** on macOS and Linux.

## 1. Make a Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and sign up with your email.
2. Open the email Cloudflare sends you and verify your address.
3. You don't need a domain or a paid plan. Workers' free plan is enough.

## 2. Install the server's tools and sign in to Cloudflare

In a terminal:

```bash
cd path/to/slate/mcp-remote
npm install
npx wrangler login
```

`wrangler login` opens your browser. Choose **Allow** to let Wrangler (Cloudflare's command-line tool) manage Workers on your account, then return to the terminal.

## 3. Tell the server which notes and which person

Open `mcp-remote/wrangler.jsonc` in a text editor and change these two lines:

```jsonc
"GITHUB_REPO": "your-name/slate-notes",         // the repository Slate syncs to
"ALLOWED_GITHUB_USER": "your-github-username"   // only this GitHub account can sign in
```

## 4. Create the server's storage

The server keeps sign-in records (never your notes) in Cloudflare KV storage. Run:

```bash
npx wrangler kv namespace create OAUTH_KV
```

It prints something like `"id": "0f2b…"`. Copy that id into `wrangler.jsonc`, replacing `PASTE_YOUR_KV_NAMESPACE_ID`.

## 5. Deploy once to get your address

```bash
npx wrangler deploy
```

The first time, Cloudflare asks you to pick a **workers.dev subdomain** (any free name, for example `bruce`). When it finishes it prints your server's address, like:

```
https://slate-mcp.bruce.workers.dev
```

Keep this address. Opening it now shows "Not set up yet", which is expected.

## 6. Create a GitHub sign-in app

This is how the server checks that it's really you.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** `Slate MCP`
   - **Homepage URL:** your address from step 5, for example `https://slate-mcp.bruce.workers.dev`
   - **Authorization callback URL:** the same address followed by `/callback`, for example `https://slate-mcp.bruce.workers.dev/callback`
3. Press **Register application**.
4. Copy the **Client ID**.
5. Press **Generate a new client secret** and copy the secret straight away (GitHub shows it only once).

## 7. Create a token for your notes repository

The server reads and writes your notes with its own GitHub token, kept as a Cloudflare secret.

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. **Token name:** `Slate MCP server`. **Expiration:** your choice (you'll repeat this step when it expires).
3. **Repository access:** **Only select repositories** → your Slate notes repository.
4. **Permissions → Repository permissions → Contents:** **Read and write**.
5. Press **Generate token** and copy it.

## 8. Give the server its secrets

Run each command, paste the value when asked and press Enter:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Secrets are encrypted by Cloudflare. They're never written to this folder, to your repository or into any reply the server sends.

## 9. Deploy again and check

```bash
npx wrangler deploy
```

Open your address in a browser. It should say **Slate MCP server**. Open `/activity` on it (for example `https://slate-mcp.bruce.workers.dev/activity`) and sign in with GitHub. You should see "No calls yet". If someone else tries, GitHub signs them in but Slate refuses them.

## 10. Connect your AI apps

In Slate, open **Settings & backups → Connect an AI app**, paste your address into **Remote server address** and press **Save**. The steps there show the exact URL to use. It's your address followed by `/mcp`.

- **claude.ai:** **Settings → Connectors → Add custom connector**. Name it Slate, paste `https://…workers.dev/mcp`, press **Add**, then **Continue with GitHub** on the Slate page that opens. The Claude mobile apps use the same connector.
- **ChatGPT (Plus or Pro):** **Settings → Apps & Connectors → Advanced settings → Developer mode** on. Then **Create**, name it Slate, paste the same URL, choose **OAuth**, create it, and sign in with GitHub when asked.

Try it: ask "Search my Slate notes for osteoclasts", or "Make a Slate page summarising this conversation". New pages and changes appear in Slate after it syncs (the cloud button syncs right away).

## Good to know

- **What it can do:** search, list and read pages; create pages; add to or rewrite a page; list and add tasks; list flashcards. It can't delete anything. Every page it changes keeps the previous version in **Page history**.
- **Your phone and the AI at the same time:** if a page was edited in Slate and by the AI before Slate synced, Slate keeps both, naming one "(from other device)", exactly as sync does between your devices.
- **Public repositories are refused**, just like Slate's sync. The server only works with a private repository.
- **Attachments** aren't read or changed.
- **Recent calls** (tool names and times only) are at `/activity` on your server, after GitHub sign-in.
- **Updating the server** after updating Slate: in `mcp-remote`, run `npm install` and then `npx wrangler deploy`.
- **When the GitHub token expires**, create a new one (step 7) and run `npx wrangler secret put GITHUB_TOKEN` again.
- **Turning it off:** remove the connector in claude.ai or ChatGPT. To delete the server completely, run `npx wrangler delete` in `mcp-remote`, then delete the OAuth app (step 6) and the token (step 7) on GitHub.
- **Custom domain:** if you serve the Worker from your own domain, add `"PUBLIC_URL": "https://your.domain"` under `vars` in `wrangler.jsonc` and use that address in steps 6 and 10.
- **Cost:** Cloudflare's free plan allows 100,000 requests a day, far more than a person uses.

## If something goes wrong

| You see | What to do |
| --- | --- |
| "Not set up yet" | One of `GITHUB_REPO`, `ALLOWED_GITHUB_USER`, `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is missing. Repeat steps 3 and 8, then deploy. |
| "There are no synced notes yet" | Turn on sync in Slate and press the cloud button once. |
| "The sync repository is public" | Make the repository private on GitHub (**Settings → General → Danger zone → Change visibility**). |
| "GitHub didn't accept the server's token" | The token expired or was deleted. Repeat step 7, then `npx wrangler secret put GITHUB_TOKEN`. |
| GitHub says "redirect_uri is not associated" | The callback URL in step 6 must be your address plus `/callback`, exactly. |
| "This Slate server is private" | You signed in to GitHub with a different account than `ALLOWED_GITHUB_USER`. |
| Logs | `npx wrangler tail` shows live requests; the Cloudflare dashboard has the same under **Workers & Pages → slate-mcp → Logs**. |
