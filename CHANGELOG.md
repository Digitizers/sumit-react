# Changelog

All notable changes to this package are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `SumitChargeMode` is now actually exported from `sumit-react/next` — 0.2.0 advertised the type but the barrel never re-exported it.
- `createSumitChargeRoute` validates `mode` at creation time. An unknown mode (e.g. `"oneoff"` from an untyped consumer) now throws a clear configuration error instead of sending requests to `https://api.sumit.co.ilundefined`.
- Publish workflows: only `main` may publish (`workflow_dispatch` was unrestricted), the stale `sumit-api` sibling checkout/build is gone (the dependency installs from npm), and the GitHub Packages workflow no longer points installs at `npm.pkg.github.com` — the publish step configures that registry itself.

## [0.2.0] - 2026-05-02

### Added

- `createSumitChargeRoute` accepts `mode: "recurring" | "oneOff"` (default `"recurring"`). One-off mode targets `POST /billing/payments/charge/`, calls `buildOneOffChargePayload` from `sumit-api`, and relaxes the `durationMonths` validation requirement. The same `<SumitCheckout />` and `SingleUseToken` work for both modes.
- Type export: `SumitChargeMode`.

### Changed

- Internal switch from `normalizeRecurringChargeResponse` to its new alias `normalizeChargeResponse`. Behaviour identical.
- `peerDependencies.sumit-api` bumped to `>=0.2.0` (one-off mode imports the new `buildOneOffChargePayload`).

### Notes

- Existing recurring callers see no change.

## [0.1.1] - 2026-05-01

### Changed

- Hardened `verifySumitSharedSecret` (constant-time and length-independent comparison via SHA-256).
- `<SumitCheckout />` uses a synchronous `useRef` guard against double-submit races.
- Misc test, route, and configuration improvements; CI now builds `sumit-api` as a sibling.

## [0.1.0] - 2026-05-01

### Added

- Initial release.
- `<SumitCheckout />` React component, `useSumitCheckout` hook, `loadSumitPayments` / `createSingleUseToken` client utilities.
- `createSumitChargeRoute`, `createSumitWebhookRoute`, `verifySumitSharedSecret` Next.js / Web Standard route helpers.
