# @digitizers/sumit-react

[![npm](https://img.shields.io/npm/v/@digitizers/sumit-react.svg)](https://www.npmjs.com/package/@digitizers/sumit-react)
[![types](https://img.shields.io/npm/types/@digitizers/sumit-react.svg)](https://www.npmjs.com/package/@digitizers/sumit-react)
[![license](https://img.shields.io/npm/l/@digitizers/sumit-react.svg)](LICENSE)
[![react](https://img.shields.io/badge/react-%E2%89%A518-61DAFB?logo=react&logoColor=white)](package.json)
[![next](https://img.shields.io/badge/next.js-app%20router-000000?logo=next.js&logoColor=white)](https://nextjs.org)

> React components and Next.js route helpers for [SUMIT / OfficeGuy / Upay](https://sumit.co.il) payments. The companion to [`@digitizers/sumit-api`](https://github.com/Digitizers/sumit-api).

Ship a working SUMIT checkout flow in a React or Next.js app with two files: a Client Component and a route handler.

| Export | What it does |
| --- | --- |
| `<SumitCheckout />` | Client component that loads SUMIT's `payments.js`, renders the card-input form with the correct field names, and produces a one-time `SingleUseToken` on submit. |
| `useSumitCheckout()` | Hook for tracking checkout state (`idle \| submitting \| succeeded \| failed`). |
| `createSumitChargeRoute()` | Next.js App Router (or any Web-Standard) `POST` handler factory that calls the SUMIT recurring-charge endpoint with your server credentials and returns a normalized event. |
| `createSumitWebhookRoute()` | `POST` handler factory for SUMIT Triggers (JSON, `application/x-www-form-urlencoded`, and `json=…` envelope shapes), with optional shared-secret verification. |

> **Card data never touches your server.** The component renders a form whose card inputs are read by SUMIT's `payments.js` directly; only the resulting `SingleUseToken` is forwarded to your API route.

---

## Contents

1. [Install](#install)
2. [Render the checkout (Client Component)](#1-render-the-checkout-client-component)
3. [Charge route (server)](#2-charge-route-server)
4. [Webhook route (server)](#3-webhook-route-server)
5. [SUMIT environment](#sumit-environment)
6. [API surface](#api-surface)
7. [Local development](#local-development)
8. [Acknowledgements](#acknowledgements)
9. [License](#license)

---

## Install

```bash
pnpm add @digitizers/sumit-react @digitizers/sumit-api
```

`react` (and optionally `next`) are peer dependencies of your app. SUMIT's `payments.js` is loaded from `https://app.sumit.co.il/scripts/payments.js` at runtime.

---

## 1. Render the checkout (Client Component)

```tsx
"use client";

import { SumitCheckout, useSumitCheckout } from "@digitizers/sumit-react/client";

export function Checkout() {
  const checkout = useSumitCheckout();

  async function handleToken(singleUseToken: string) {
    const res = await fetch("/api/sumit/charge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        singleUseToken,
        customer: { externalIdentifier: "org_123", name: "Acme Ltd", emailAddress: "billing@example.com" },
        item: { name: "Pro Plan", description: "Monthly", unitPrice: 19, currency: "USD", durationMonths: 1 },
      }),
    });
    if (!res.ok) checkout.handleError(new Error(await res.text()));
  }

  return (
    <SumitCheckout
      ref={checkout.ref}
      companyId={Number(process.env.NEXT_PUBLIC_SUMIT_COMPANY_ID)}
      apiPublicKey={process.env.NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY!}
      environment="production"
      language="he-IL"
      onTokenizationStart={checkout.handleStart}
      onToken={(token) => {
        checkout.handleToken(token);
        return handleToken(token);
      }}
      onError={checkout.handleError}
    >
      <button type="submit" disabled={checkout.status === "submitting"}>
        {checkout.status === "submitting" ? "מעבד..." : "שלם"}
      </button>
      {checkout.status === "failed" ? <p role="alert">{checkout.error?.message}</p> : null}
    </SumitCheckout>
  );
}
```

The component renders the inputs SUMIT expects (`og-ccnum`, `og-expmonth`, `og-expyear`, `og-cvv`, optional `og-citizenid`, hidden `og-token`). You control the surrounding markup and styling via `classNames`, `style`, and `children` (typically a submit button).

---

## 2. Charge route (server)

```ts
// app/api/sumit/charge/route.ts
import { createSumitChargeRoute } from "@digitizers/sumit-react/next";

export const POST = createSumitChargeRoute({
  companyId: Number(process.env.SUMIT_COMPANY_ID),
  apiKey: process.env.SUMIT_API_KEY!,
  onResult: async (event) => {
    if (event.ok && event.eventType === "recurring.charged") {
      // persist event.customerId, event.recurringItemId, event.paymentId
    }
  },
});
```

What the handler does:

| Step      | Behaviour                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Validate  | Checks the JSON body shape (`singleUseToken`, `customer`, `item`).                                       |
| Build     | Calls `buildRecurringChargePayload` from `@digitizers/sumit-api`.                                        |
| Send      | `POST`s to `https://api.sumit.co.il/billing/recurring/charge/`.                                          |
| Normalize | Calls `normalizeRecurringChargeResponse`.                                                                |
| Respond   | `200` success, `402` declined, `400` bad input, `502` upstream failure — sensitive fields **redacted**.  |

---

## 3. Webhook route (server)

```ts
// app/api/sumit/webhook/route.ts
import { createSumitWebhookRoute, verifySumitSharedSecret } from "@digitizers/sumit-react/next";

export const POST = createSumitWebhookRoute({
  verify: verifySumitSharedSecret(process.env.SUMIT_WEBHOOK_SECRET!),
  onEvent: async (event) => {
    // event is a NormalizedSumitEvent — already redacted, safe to log/persist
    if (event.eventType === "sumit.trigger.unmapped") {
      // Store the safe reconciliation fields and decide whether to promote it.
    }
  },
});
```

Accepts JSON, `application/x-www-form-urlencoded`, and SUMIT's `json=<serialized>` envelope. Returns `200` on success, `401` when verification fails, `500` (without leaking the original error) when your handler throws.

---

## SUMIT environment

| Environment              | URL loaded by `<SumitCheckout />`                  |
| ------------------------ | -------------------------------------------------- |
| `production` *(default)* | `https://app.sumit.co.il/scripts/payments.js`      |
| `dev`                    | `http://dev.sumit.co.il/scripts/payments.js`       |

`companyId` and `apiPublicKey` are safe to expose to the browser. The `apiKey` (without "Public") is **server-only** and must never reach the client.

---

## Security

| Concern | How it's handled |
| --- | --- |
| **Card data exposure** | SUMIT's `payments.js` reads card fields directly and returns a `SingleUseToken`. Card numbers, expiry, and CVV never reach your server or your component state. |
| **Server credential leakage** | The full `apiKey` lives only in `createSumitChargeRoute`; `./client` and `./next` are separate exports so client bundles cannot transitively pull the server secret. |
| **Webhook spoofing** | `verifySumitSharedSecret` hashes both the candidate and the secret to a fixed 32-byte digest before comparing — the comparison is constant-time **and** length-independent, so response timing leaks neither secret content nor secret length. |
| **Double-submit / token reuse** | `<SumitCheckout />` uses a synchronous ref guard so two rapid submits cannot both fire `CreateToken` (single-use tokens are exactly that — single-use). |
| **Logging sensitive data** | Every event the route helpers return passes through `redactSumitPayload` from `@digitizers/sumit-api`. |

---

## API surface

```ts
// from @digitizers/sumit-react/client
SumitCheckout(props): JSX.Element
  props.companyId, apiPublicKey, environment?, language?
  props.requireCvv?, requireCitizenId?
  props.onToken, onError?, onTokenizationStart?, onTokenizationEnd?
  props.classNames?, style?, labels?
useSumitCheckout(): { ref, status, error, token, submit, reset, handleToken, handleError, handleStart }
loadSumitPayments(env?): Promise<SumitPaymentsSdk>
createSingleUseToken(settings): Promise<string>

// from @digitizers/sumit-react/next
createSumitChargeRoute(config): (request: Request) => Promise<Response>
createSumitWebhookRoute(config): (request: Request) => Promise<Response>
verifySumitSharedSecret(secret, options?): SumitWebhookVerifier
```

---

## Local development

This package has `@digitizers/sumit-api` as a peer dependency. While `sumit-api` is being published to npm, the dev dependency in this repo points at `file:../sumit-api`, so cloning both repos as siblings is the supported local setup:

```text
~/code/
├── sumit-api/        # https://github.com/Digitizers/sumit-api
└── sumit-react/      # this repo
```

Then:

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsc → dist/
```

Once `@digitizers/sumit-api` is published, the dev dependency will switch to a regular semver range and CI will install it from the registry.

---

## Acknowledgements

The browser-side API surface (`OfficeGuy.Payments.CreateToken` and the `og-*` form fields) was reverse-engineered from the official [SUMIT WooCommerce plugin](https://wordpress.org/plugins/woo-payment-gateway-officeguy/) (GPL-2.0+). No code is copied from that plugin; this implementation is independent and MIT-licensed.

---

## License

[MIT](LICENSE)
