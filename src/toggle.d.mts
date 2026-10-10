import type { JSONContent } from "@tiptap/react";
import type { Workspace } from "./types";
export type ToggleParts = {
  id: string;
  summary: string;
  blocks: JSONContent[];
  ownText: string;
  answer: string;
};
export function revealToToggle(node: JSONContent): JSONContent;
export function migrateContent<T extends JSONContent | undefined>(node: T): T;
export function migrateWorkspace<T extends Workspace>(data: T): T;
export function toggleParts(node: JSONContent): ToggleParts;
export function studyToggle(node: JSONContent | undefined): ToggleParts | null;
