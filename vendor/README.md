# Vendored package artifact

`saas-maker-ai-visibility-0.1.0.tgz` is the local packed artifact built from
`foundry/packages/ai-visibility` in `sass-maker/fleet-workspace`.
Its reviewed source is commit
`f85d99ff4fa322b6b8877b61d3b12b089e4f2379` (Fleet Workspace PR
[#9](https://github.com/sass-maker/fleet-workspace/pull/9)).
That merge includes the hostname-boundary regression fix: an owned citation
must match the configured host or one of its subdomains.

It is intentionally used until the package has separate publish approval.
High Signal consumes only the package's public exports through
`packages/shared` and its worker adapter. Replace this file dependency with the
published version after the package release is approved; do not edit the
archive in this repository.
