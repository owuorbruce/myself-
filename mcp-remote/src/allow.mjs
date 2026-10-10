/** Only the GitHub account in ALLOWED_GITHUB_USER may sign in (GitHub logins are case-insensitive). */
export const allowed = (env, login) =>
  typeof login === "string" && !!env.ALLOWED_GITHUB_USER && login.toLowerCase() === String(env.ALLOWED_GITHUB_USER).trim().toLowerCase();
