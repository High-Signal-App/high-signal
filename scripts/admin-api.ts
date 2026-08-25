export async function postAdminJson(
  path: string,
  payload: unknown,
  logPrefix: string
): Promise<void> {
  const apiBase = (process.env['API_BASE'] ?? 'https://api.highsignal.app').replace(/\/$/, '');
  const adminToken = process.env['ADMIN_TOKEN'];
  if (!adminToken) {
    throw new Error(`${logPrefix} ADMIN_TOKEN is required for API sync`);
  }

  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `${logPrefix} API sync failed: HTTP ${response.status}${responseText ? ` ${responseText}` : ''}`
    );
  }
  console.log(`${logPrefix} API sync complete: ${responseText}`);
}
