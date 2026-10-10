import type { JSONContent } from "@tiptap/react";
import type { Task, Workspace } from "./types";

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
};
export const NOTE_TOOLS: ToolDefinition[];
export class ToolError extends Error {}
export type ToolDeps = { parse(markdown: string): JSONContent; newId(): string; plain(doc: JSONContent): string; now?: number };
export type Change =
  | { kind: "create_page"; title: string; parentId: string | null; content: JSONContent; markdown: string; pageId: string }
  | { kind: "update_page"; pageId: string; title: string; mode: "replace" | "append"; added: JSONContent; after: JSONContent; beforeMarkdown: string; afterMarkdown: string; basedOn: number }
  | { kind: "create_task"; task: Task };
export type Undo =
  | { kind: "create_page"; pageId: string }
  | { kind: "update_page"; pageId: string; content: JSONContent; title: string }
  | { kind: "create_task"; taskId: string };
export function checkArgs(name: string, args: unknown): Record<string, string>;
export function pagePath(data: Workspace, pageId: string): string;
export function runTool(
  name: string,
  args: unknown,
  ctx: { data: Workspace; scope?: Set<string> | null; deps: ToolDeps },
): { result: unknown; change?: Change };
export function applyChange(data: Workspace, change: Change, deps: ToolDeps): { data: Workspace; undo: Undo };
export function undoChange(data: Workspace, undo: Undo, deps: ToolDeps): Workspace;
