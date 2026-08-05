# Public agent Markdown cache

## ADDED Requirements

### Requirement: canonical public Markdown is edge-cacheable

The web Worker SHALL use a stable edge-cache key for an anonymous `GET` request
to an index-eligible canonical `.md` URL with no query string.

#### Scenario: cache miss

- **WHEN** the cache has no response for an eligible Markdown URL
- **THEN** the Worker renders the canonical HTML once, applies the existing
  public-corpus eligibility policy, and returns the same Markdown response as
  before
- **AND** it stores a clone asynchronously only when the response is successful,
  readable Markdown without a `Set-Cookie` header

#### Scenario: cache hit

- **WHEN** the cache contains a response for an eligible Markdown URL
- **THEN** the Worker returns it without invoking OpenNext HTML rendering

### Requirement: private and variant requests do not share Markdown cache state

The Worker SHALL bypass the public Markdown cache for authenticated requests,
requests with query strings, HEAD requests, and Accept-negotiated requests on
the canonical HTML URL.

#### Scenario: authenticated Markdown request

- **WHEN** a `.md` request carries a recognized authentication cookie
- **THEN** the Worker uses the existing render path and neither reads nor writes
  the public Markdown cache

#### Scenario: an error or withheld page is rendered

- **WHEN** the existing render path returns a non-200 response, a non-Markdown
  response, a noindex result, or a response with `Set-Cookie`
- **THEN** the Worker returns that response without storing it

### Requirement: public corpus truth remains unchanged

Caching SHALL NOT change route membership, sitemap membership, catalog entries,
Markdown content, public-corpus eligibility, or response cache TTL.

#### Scenario: repeated public crawl

- **WHEN** an agent requests a canonical public Markdown route more than once
  inside the shared freshness period
- **THEN** both responses have equivalent status, content type, and body
- **AND** the later request avoids a repeated OpenNext render
