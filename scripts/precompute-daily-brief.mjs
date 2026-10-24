#!/usr/bin/env node
import { researchCommunityBrief } from './research-community-brief.mjs';

const API = process.env.API_BASE ?? 'https://api.highsignal.app';
const token = process.env.ADMIN_TOKEN;

if (!token) throw new Error('ADMIN_TOKEN is required');

let researchError;
try {
  const research = await researchCommunityBrief({ api: API, token });
  console.log(`[community-research] ${JSON.stringify(research)}`);
} catch (error) {
  researchError = error;
  console.error(`[community-research] ${error.message}`);
}

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
if (researchError) throw researchError;
