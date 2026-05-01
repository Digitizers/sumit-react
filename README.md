# @digitizers/sumit-react

React components and Next.js route helpers for [SUMIT / OfficeGuy / Upay](https://sumit.co.il/) payments.

The companion to [`@digitizers/sumit-api`](https://github.com/Digitizers/sumit-api). This package adds the parts you need to ship a checkout in a React or Next.js app:

- `<SumitCheckout />` — a client component that loads SUMIT's `payments.js`, renders the card-input form with the correct field names, and produces a one-time tokenization (`SingleUseToken`) on submit.
- `useSumitCheckout()` — a small hook for tracking checkout state (`idle | submitting | succeeded | failed`).
- `createSumitChargeRoute()` — a Next.js App Router (or any Web-Standard) `POST` handler factory that calls the SUMIT recurring-charge endpoint with your server credentials and returns a normalized event.
- `createSumitWebhookRoute()` — a `POST` handler factory for SUMIT Triggers (JSON, `application/x-www-form-urlencoded`, and `json=...` envelope shapes), with optional shared-secret verification.

> Card data never touches your server. The component renders a form whose card inputs are read by SUMIT's `payments.js` directly; only the resulting `SingleUseToken` is forwarded to your API route.

## Install

```bash
pnpm add @digitizers/sumit-react @digitizers/sumit-api
```

`react` and (optionally) `next` are peer dependencies of your app. SUMIT's `payments.js` is loaded from `https://app.sumit.co.il/scripts/payments.js` at runtime.

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

The handler:

- Validates the JSON body shape (`singleUseToken`, `customer`, `item`).
- Builds the SUMIT payload via `buildRecurringChargePayload` from `@digitizers/sumit-api`.
- POSTs to `https://api.sumit.co.il/billing/recurring/charge/`.
- Normalizes the response via `normalizeRecurringChargeResponse`.
- Returns `200` for success, `402` for declined payments, `400` for bad input, `502` for upstream failures — and **redacts** sensitive fields before responding.

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

## SUMIT environment

| Environment | URL loaded by `<SumitCheckout />` |
| --- | --- |
| `production` (default) | `https://app.sumit.co.il/scripts/payments.js` |
| `dev` | `http://dev.sumit.co.il/scripts/payments.js` |

The `companyId` and `apiPublicKey` are safe to expose to the browser. The `apiKey` (without "Public") is **server-only** and must never be sent to the client.

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
pnpm typecheck
pnpm test
pnpm build
```

Once `@digitizers/sumit-api` is published, the dev dependency will switch to a regular semver range and CI will install it from the registry.

## Acknowledgements

The browser-side API surface (`OfficeGuy.Payments.CreateToken` and the `og-*` form fields) was reverse-engineered from the official [SUMIT WooCommerce plugin](https://wordpress.org/plugins/woo-payment-gateway-officeguy/) (GPL-2.0+). No code is copied from that plugin; this implementation is independent and MIT-licensed.

## License

MIT
