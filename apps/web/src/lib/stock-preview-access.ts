/** Local operator preview only. This never grants public display/export rights. */
export function localStockPreviewEnabled(
  mode: string | undefined,
  input: string | undefined,
  binding: string | undefined
) {
  return mode === 'development' && Boolean(input) && binding === '127.0.0.1';
}

export function localStockPreviewAllowed(
  mode: string | undefined,
  host: string | null,
  input: string | undefined,
  binding?: string
) {
  return (
    localStockPreviewEnabled(mode, input, binding) &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host ?? '')
  );
}
