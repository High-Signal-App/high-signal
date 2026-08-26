#!/usr/bin/env node

const API = process.env.API_BASE ?? 'https://api.highsignal.app';
const token = process.env.ADMIN_TOKEN;

if (!token) throw new Error('ADMIN_TOKEN is required');

const response = await fetch(`${API.replace(/\/$/, '')}/admin/brief/precompute`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
const body = await response.json().catch(() => ({}));

if (!response.ok || body?.globalPublished !== true) {
  throw new Error(`global brief precompute failed (${response.status}): ${JSON.stringify(body)}`);
}

const global = body.regions?.find((region) => region.region === 'global');
console.log(
  `[brief-precompute] ${body.date} global published ${JSON.stringify(global?.counts ?? {})}`
);
