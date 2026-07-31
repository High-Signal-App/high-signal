# bounded-worker-routing Specification

## Purpose
Define the safe boundary between verified static assets that can bypass the
OpenNext Worker and application routes that require Worker-first handling.

## Requirements

### Requirement: Immutable assets bypass Worker-first execution
The High Signal Cloudflare configuration SHALL route verified immutable build
assets through the static asset binding before invoking `high-signal-web`.

#### Scenario: Next.js static asset request
- **WHEN** a request targets `/_next/static/*`
- **THEN** the asset binding is evaluated before the OpenNext Worker

#### Scenario: Astro landing asset request
- **WHEN** a request targets `/_astro/*`
- **THEN** the asset binding is evaluated before the OpenNext Worker

#### Scenario: Static discovery or icon request
- **WHEN** a request targets a tracked top-level file that exists in the
  generated asset output
- **THEN** the asset binding is evaluated before the OpenNext Worker

### Requirement: Application routes remain Worker-first by default
The High Signal Cloudflare configuration SHALL retain Worker-first handling for
application routes unless a route is explicitly proven to be a generated static
asset.

#### Scenario: Authenticated or personalized route
- **WHEN** a request targets an authenticated, operator, personalized, API, or
  write route
- **THEN** the request continues through the OpenNext Worker

#### Scenario: Unlisted route
- **WHEN** a request does not match an explicit static asset exclusion
- **THEN** the request continues through the OpenNext Worker

### Requirement: Request-independent history page is prerendered
The `/history` page MUST be declared static while its implementation contains
no request, authentication, API, time, random, or personalization input.

#### Scenario: Production build
- **WHEN** the High Signal Next.js production build runs
- **THEN** `/history` is reported as a static route

#### Scenario: History content changes to become request-dependent
- **WHEN** `/history` is changed to read request-dependent or personalized data
- **THEN** its static declaration and routing contract are reviewed before the
  change ships

### Requirement: Routing protections are covered by focused validation
The repository SHALL include a deterministic test for the required asset
bypasses, the Worker-first default, and the `/history` static declaration.

#### Scenario: Required bypass is removed
- **WHEN** a required immutable asset exclusion is removed from the Cloudflare
  configuration
- **THEN** the focused routing test fails

#### Scenario: Broad application bypass is introduced
- **WHEN** the configuration stops using Worker-first handling as the default
  for application routes
- **THEN** the focused routing test fails

#### Scenario: History regresses to dynamic rendering
- **WHEN** `/history` is changed back to `force-dynamic`
- **THEN** the focused routing test fails
