import type { Workspace } from "./types";
export function mergePages(
  current: Workspace,
  incoming: Workspace,
  newId: () => string,
  now?: number,
): { data: Workspace; files: Map<string, string>; roots: string[]; placed: number };
