# CLAUDE.md

Guidance for AI assistants working in this repository.

## Project

`sumit-react` — React component (`<SumitCheckout />`), checkout state hook (`useSumitCheckout`), and Next.js route helpers (`createSumitChargeRoute`, `createSumitWebhookRoute`) for SUMIT / OfficeGuy / Upay payments.

Companion package: [`sumit-api`](https://github.com/Digitizers/sumit-api) (peer dependency).

## Architecture

Two entry points, kept strictly separate:

| Path | Surface | Notes |
| --- | --- | --- |
| `./client` | `SumitCheckout`, `useSumitCheckout`, `loadSumitPayments`, `createSingleUseToken` | Browser-only. Loads `payments.js` from SUMIT. **Card data never touches our server** — SUMIT's script reads form fields directly. |
| `./next` | `createSumitChargeRoute`, `createSumitWebhookRoute`, `verifySumitSharedSecret` | Server-only. Uses Web Standard `Request` / `Response` so it works in Edge and Node runtimes. |

**Never import from `./next` in client code.** The server bundle holds the SUMIT `apiKey`; leaking it to the browser is a P0.

## Conventions

- **Web Standards everywhere on the server.** No `node:*` imports unless absolutely necessary. The webhook timing-safe compare uses `crypto.subtle` (Web Crypto) so the route works in Edge.
- **Strict TypeScript.** No `any`. `forwardRef` + `useImperativeHandle` over prop drilling for imperative checkout control.
- **Comments only explain WHY.** Don't restate what the code does.
- **Tests are colocated** (`*.test.ts(x)`) using Vitest with happy-dom. New behavior gets a test.

## Security model

This package handles payments. Three rules:

1. **Server credentials never reach the client.** The `apiKey` is only consumed by `createSumitChargeRoute`. The `apiPublicKey` may be exposed.
2. **Webhook verification is constant-time AND length-independent.** `verifySumitSharedSecret` hashes both the candidate and the secret to a fixed-length digest before comparing — a length-dependent path leaks the secret's byte-length via response timing.
3. **Tokenization is single-flight.** `<SumitCheckout />` uses a synchronous `useRef` guard so two rapid submits cannot both fire `CreateToken` (a stale-closure on `useState` would let the second slip through).

All payloads forwarded to clients pass through `redactSumitPayload` from `sumit-api`.

## Workflow

```bash
pnpm install
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc → dist/
```

Local development assumes `sumit-api` is checked out as a sibling directory (the `devDependencies` entry uses `file:../sumit-api`).

Branches: `fix/*`, `feat/*`, `chore/*`. PRs to `main`. Conventional-commit-ish messages.
