interface Window {
  slateDesktop?: {
    openSignIn(url: string): Promise<void>;
    onBeforeClose(handler: () => Promise<boolean>): () => void;
  };
}
