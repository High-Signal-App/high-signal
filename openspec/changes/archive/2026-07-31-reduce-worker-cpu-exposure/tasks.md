## 1. Routing Contract

- [x] 1.1 Add a focused test for immutable asset bypasses, the Worker-first
  application default, and `/history` static rendering
- [x] 1.2 Add the focused test to the existing concurrent root test runner

## 2. Implementation

- [x] 2.1 Exclude verified immutable Next.js, Astro, docs, discovery, and icon
  assets from Worker-first execution
- [x] 2.2 Change `/history` from forced dynamic rendering to forced static
  rendering

## 3. Verification

- [x] 3.1 Run the focused routing test and OpenSpec strict validation
- [x] 3.2 Run the High Signal typecheck and Cloudflare build
- [x] 3.3 Confirm the build reports `/history` as static and the excluded asset
  paths exist in `.open-next/assets`
- [x] 3.4 Review the final diff and confirm no deployment, dependency, secret,
  database, or production application mutation occurred
