import type { Workspace } from "./types";
export function mergeWorkspaces(
  local: Workspace,
  remote: Workspace,
  state: { lastSync?: number; dirty?: boolean },
  newId: () => string,
  now?: number,
): { data: Workspace; conflicts: string[] };
export function rebaseEdits(
  before: Workspace,
  current: Workspace,
  merged: Workspace,
): Workspace;
