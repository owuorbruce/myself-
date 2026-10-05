# Reliability verification

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
