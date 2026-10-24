/** Bounded public-community research through the existing free-AI operator path. */
export async function researchCommunityBrief({ api, token, fetchImpl = fetch }) {
  const base = `${api.replace(/\/$/, '')}/admin/communities/research`;
  async function read(path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(125_000),
    });
    const result = await response.json().catch(() => null);
    if (!result || (!response.ok && !(response.status === 503 && result.status === 'unavailable')))
      throw new Error(`Community research unavailable (HTTP ${response.status})`);
    return result;
  }
  await read('/initialize', {});
  const plan = await read('');
  if (!Array.isArray(plan.communities)) throw new Error('Invalid public community plan');
  // Round-robin keeps one noisy community from consuming the whole run.
  const attempts = [];
  for (let index = 0; index < 3; index++)
    for (const community of plan.communities) {
      if (community.leads?.[index])
        attempts.push({ communityId: community.id, leadId: community.leads[index].id });
    }
  const counts = { published: 0, already_published: 0, withheld: 0 };
  const unavailable = [];
  for (const attempt of attempts.slice(0, 6)) {
    const result = await read('', attempt);
    if (result.status === 'unavailable') {
      unavailable.push(result.reason ?? 'invalid response');
      continue;
    }
    if (!(result.status in counts))
      throw new Error(`Community research failed: ${result.reason ?? 'invalid response'}`);
    counts[result.status]++;
  }
  if (unavailable.length)
    throw new Error(
      `Community research failed: ${unavailable.join(', ')}; completed ${JSON.stringify(counts)}`
    );
  return counts;
}
