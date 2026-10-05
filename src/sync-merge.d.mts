import type { Workspace } from "./types";
export function mergeWorkspaces(
  local: Workspace,
  remote: Workspace,
  state: { lastSync?: number; dirty?: boolean; base?: Workspace },
  newId: () => string,
  now?: number,
): { data: Workspace; conflicts: string[] };
export function rebaseEdits(
  before: Workspace,
  current: Workspace,
  merged: Workspace,
): Workspace;


export function prepareRestore(previous: Workspace, restored: Workspace, now?: number): Workspace;
