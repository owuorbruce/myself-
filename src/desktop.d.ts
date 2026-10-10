interface Window {
  slateDesktop?: {
    onMcpCall(handler: (name: string, args: Record<string, unknown>) => Promise<unknown>): () => void;
    openSignIn(url: string): Promise<void>;
    onBeforeClose(handler: () => Promise<boolean>): () => void;
  };
}
