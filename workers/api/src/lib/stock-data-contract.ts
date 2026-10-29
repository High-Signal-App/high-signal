import type { StockDataset } from '../../../../packages/shared/src/stock-data/public';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function contentId(prefix: string, value: unknown) {
  return `${prefix}:${await digest(new TextEncoder().encode(canonicalJson(value)))}`;
}

export interface StockRecord {
  kind: string;
  id: string;
  payload: Record<string, unknown>;
}

export async function boundedBody(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const item = await reader.read();
    if (item.done) return text + decoder.decode();
    size += item.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(item.value, { stream: true });
  }
}

export async function validRecord(record: StockRecord): Promise<boolean> {
  if (!record || !record.payload || typeof record.payload !== 'object') return false;
  const payload = record.payload;
  if (record.kind === 'blob') {
    if (typeof payload['base64'] !== 'string' || payload['base64'].length > 350_000) return false;
    try {
      return (
        record.id ===
        `blob:${await digest(Uint8Array.from(atob(payload['base64']), (char) => char.charCodeAt(0)))}`
      );
    } catch {
      return false;
    }
  }
  let identity: unknown = payload;
  if (record.kind === 'fact') {
    const { ingested_at: _ingestedAt, ...fact } = payload;
    identity = fact;
  } else if (record.kind === 'evidence') {
    identity = Object.fromEntries(
      ['source_id', 'url', 'sha256', 'available_at', 'media_type'].map((key) => [key, payload[key]])
    );
  } else if (!['entity', 'security', 'rights', 'snapshot'].includes(record.kind)) return false;
  return record.id === (await contentId(record.kind, identity));
}

export async function validPublication(value: StockDataset): Promise<boolean> {
  if (
    !value ||
    value.contract_version !== 'stock-data.v1' ||
    !['display', 'export'].includes(value.audience) ||
    !value.snapshot_id ||
    !Number.isFinite(Date.parse(value.as_of)) ||
    Date.parse(value.as_of) > Date.now() + 60_000 ||
    !Array.isArray(value.facts) ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.valuations) ||
    !value.rights_versions ||
    typeof value.rights_versions !== 'object'
  )
    return false;
  const rights = new Map((value.usage_rights ?? []).map((right) => [right.id, right]));
  const evidence = new Map(value.evidence.map((row) => [row.id, row]));
  for (const document of value.evidence) {
    const identity = {
      source_id: document.source_id,
      url: document.url,
      sha256: document.sha256,
      available_at: document.available_at,
      media_type: document.media_type,
    };
    if (document.id !== (await contentId('evidence', identity))) return false;
  }
  const describedFacts = [
    ...value.facts,
    ...value.changes
      .flatMap((change) => [change.before, change.after])
      .filter((fact) => fact !== null),
  ];
  for (const fact of describedFacts) {
    const document = evidence.get(fact.evidence_id);
    const permission = document ? rights.get(document.source_id) : undefined;
    if (
      !document ||
      !document.url.startsWith('https://') ||
      !permission ||
      permission[value.audience === 'display' ? 'public_display' : 'export'] !== 'permitted' ||
      !permission.reviewed_at ||
      !permission.policy_url.startsWith('https://') ||
      !Number.isFinite(Date.parse(permission.reviewed_at)) ||
      !fact.id ||
      !fact.entity_id ||
      !fact.locator ||
      (fact.value !== null &&
        (typeof fact.value !== 'string' ||
          !/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(fact.value))) ||
      ![fact.effective_at, fact.available_at].every(
        (date) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.parse(value.as_of)
      ) ||
      !Number.isFinite(Date.parse(fact.ingested_at)) ||
      Date.parse(fact.ingested_at) > Date.now() + 60_000 ||
      Date.parse(fact.available_at) > Date.parse(fact.ingested_at)
    )
      return false;
    if (value.rights_versions[document.source_id] !== (await contentId('rights', permission)))
      return false;
    const { id, ingested_at: _ingestedAt, ...factIdentity } = fact;
    if (id !== (await contentId('fact', factIdentity))) return false;
  }
  const facts = new Set(value.facts.map((fact) => fact.id));
  for (const valuation of value.valuations) {
    if (
      !valuation.input_fact_ids.every((id) => facts.has(id)) ||
      !valuation.input_snapshot_ids.includes(value.snapshot_id) ||
      (valuation.ranking_eligible &&
        (valuation.coverage !== 'complete' ||
          valuation.freshness !== 'fresh' ||
          valuation.discount_to_nav === null))
    )
      return false;
  }
  const { publication_id: id, ...payload } = value;
  return id === (await contentId('publication', payload));
}

export async function publicationRightsCurrent(
  database: D1Database,
  value: StockDataset
): Promise<boolean> {
  for (const [source, version] of Object.entries(value.rights_versions)) {
    const row = await database
      .prepare(
        "SELECT id,payload_json FROM stock_data_records WHERE kind='rights' AND json_extract(payload_json,'$.id')=? ORDER BY sequence DESC LIMIT 1"
      )
      .bind(source)
      .first<{ id: string; payload_json: string }>();
    if (!row || row.id !== version) return false;
    const rights = JSON.parse(row.payload_json);
    if (rights[value.audience === 'display' ? 'public_display' : 'export'] !== 'permitted')
      return false;
  }
  return true;
}
