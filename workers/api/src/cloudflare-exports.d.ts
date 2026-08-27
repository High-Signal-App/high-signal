export {};

declare global {
  interface ExecutionContext<Props = unknown> {
    /** Present in production when enable_ctx_exports is active. */
    readonly exports?: Cloudflare.Exports;
  }

  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./index');
    }
  }
}
