/** Local operator preview only. This never grants public display/export rights. */
export function localStockPreviewAllowed(
  mode: string | undefined,
  host: string | null,
  input: string | undefined
) {
  return (
    mode === 'development' &&
    Boolean(input) &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host ?? '')
  );
}
