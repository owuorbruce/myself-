export function validateWorkspace(w: unknown): unknown;
export function validDoc(w: unknown): boolean;
export function canMove(
  pages: { id: string; parentId: string | null; trashed: boolean }[],
  id: string,
  parentId: string | null,
): boolean;
