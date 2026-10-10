type McpConfig = { enabled: boolean; token: string; remoteUrl: string; log: { tool: string; at: number }[]; ready: boolean };
interface Window {
  slateDesktop?: {
    openSignIn(url: string): Promise<void>;
    onBeforeClose(handler: () => Promise<boolean>): () => void;
    mcp?: {
      config(): Promise<McpConfig>;
      set(patch: { enabled?: boolean; remoteUrl?: string }): Promise<McpConfig>;
      regenerate(): Promise<McpConfig>;
      onCall(handler: (name: string, args: unknown) => Promise<unknown>): () => void;
    };
  };
}
