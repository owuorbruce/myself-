# ChatGPT integration verification

The combined suite passes **66 Node tests** (`npm test`), including the existing 43 project tests and 23 new ChatGPT tests. The production build passes TypeScript checks and generates the offline service worker.

## ChatGPT checks

- Fresh and returning OAuth requests use PKCE, state, nonce, a stable host ID, issued client IDs and the exact loopback callback URI. Failed exchanges retain registrations for retry.
- RSA-signed ID tokens are verified against JWKS; invalid signature, issuer, audience, expiry, nonce or identity cannot replace an existing account.
- Actual granted token scopes control inference access. Public session responses never expose access, refresh or ID tokens or the host ID.
- Concurrent refreshes rotate one token set; losing plan permission prevents inference. Account credentials stay separate when selecting or signing out.
- Remote revocation is attempted with retry/backoff. Failed revocation is reported while local tokens are cleared and client registration is retained.
- Credential writes are atomic; Unix directory/file permissions and temporary-file cleanup are checked.
- Model choices use the account catalog. Requests use the documented public Responses endpoint and supported input fields with `store: false` and streaming enabled.
- Split UTF-8 and CRLF streams work. Completion returns promptly even if the upstream stays open. Interrupted, malformed, incomplete, usage-limited and empty replies fail instead of reporting success.
- The real HTTP router rejects unexpected Host, cross-origin requests, missing CSRF tokens, incorrect content types and invalid messages. Callback content is escaped and framed content is blocked.
- Client tests execute the actual transpiled TypeScript module. Blocked popups do not start OAuth; external sign-in links are rejected; partial replies cannot become completed answers.
- Offline navigation excludes `/api/` and `/auth/`, so the service worker cannot swallow authorization redirects or callbacks.
- Generated flashcards are bounded, validated JSON before workspace insertion.
- A smoke check launches the real local server with isolated storage, serves the built app, obtains a local session, checks the OAuth redirect and confirms server source/credential files are not publicly served.

## Limits

Tests use generated test identities and simulated OpenAI responses. No real ChatGPT credentials were used. Account eligibility, consent, available models and a live response remain to be verified when the user signs in locally.

A Chromium UI check could not start in this environment; the available browser exits before assertions. Downloading a replacement browser also failed. This is not evidence of a successful visual or browser OAuth test.

The checked-in `dist/` is rebuilt for the dependency-free launcher. GitHub Pages builds from source with its repository base path. The hosted site shows local setup instructions and keeps the existing manual AI workflow.

# Earlier reliability verification

The reliability patch passed **41 Node tests** (`npm test`) and a production build (`npm run build`, including TypeScript checks and service-worker generation).

## Scope

- Connecting sync keeps existing and imported notes; failed first reads do not clear them.
- Last-successful-sync baselines merge task/card fields and collection rows independently. Simultaneous conflicting values keep recovery copies. Tests check that inputs are unchanged and merged backups validate.
- Numeric signs and decimal points are preserved. Near matches never automatically increase correct-answer counts or successful review intervals; explicit accepted aliases still work.
- Blank reviews resolve current source text and answers, including older records without references and nested blanks. Deleted blanks and obsolete automatic questions are removed from daily/weak/due counts.
- Restores mark sync dirty, record replaced-record deletions and explicit recovery markers, and upload after a previously clean sync. Old deletion markers cannot erase explicitly restored records; newer deletions still apply.
- Attachment download errors, missing bytes, truncated files, remote size mismatches and upload validation failures stop sync before workspace metadata is uploaded or sync state is marked complete. Successful transfers precede metadata uploads.
- Existing backup validation, hierarchy, scheduling, streak and edit-rebasing tests continue to pass.

## Test method and limits

Regression tests execute the actual TypeScript study and sync helpers, transpiled by the project's TypeScript dependency. IndexedDB is replaced with an in-memory store and the GitHub API with deterministic responses, including failure responses. No new dependencies were added.

The application also guards a restore against an older in-flight sync applying its result. An attempted Chromium UI check could not start: the browser process exited with SIGSEGV before any assertions. The earlier version's browser-check count is not evidence for this patch and is not repeated here.

Sync failure and merge cases were tested against a simulated API, not a live private notes repository. GitHub Actions runs the test suite and builds the hosted app during deployment.

The checked-in `dist/` folder is rebuilt for the dependency-free local launcher. GitHub Pages builds from source with the repository base path.
