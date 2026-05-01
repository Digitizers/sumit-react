import { describe, expect, it, vi } from "vitest";

import { createSumitWebhookRoute, verifySumitSharedSecret } from "./createWebhookRoute.js";

describe("createSumitWebhookRoute", () => {
  it("normalizes JSON payloads and invokes onEvent", async () => {
    const onEvent = vi.fn();
    const handler = createSumitWebhookRoute({ onEvent });
    const response = await handler(
      new Request("https://example.com/api/sumit/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Folder: "Charges",
          EntityID: "777",
          Type: "PaymentSucceeded",
          Properties: { Property_3: [{ ID: "1" }] },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(onEvent).toHaveBeenCalledOnce();
    const [event] = onEvent.mock.calls[0] as [{ paymentId?: string; customerId?: string; eventType: string }];
    expect(event.eventType).toBe("sumit.trigger.unmapped");
    expect(event.paymentId).toBe("777");
    expect(event.customerId).toBe("1");
  });

  it("normalizes form-encoded payloads", async () => {
    const onEvent = vi.fn();
    const handler = createSumitWebhookRoute({ onEvent });
    const body = new URLSearchParams({
      "Payment.Status": "000",
      "Payment.ValidPayment": "true",
      "Payment.ID": "p1",
      "RecurringCustomerItemIDs[0]": "444",
    }).toString();

    const response = await handler(
      new Request("https://example.com/api/sumit/webhook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );

    expect(response.status).toBe(200);
    const [event] = onEvent.mock.calls[0] as [{ eventType: string; paymentId?: string }];
    expect(event.eventType).toBe("recurring.charged");
    expect(event.paymentId).toBe("p1");
  });

  it("returns 401 when verify rejects", async () => {
    const onEvent = vi.fn();
    const verify = vi.fn().mockResolvedValue(false);
    const handler = createSumitWebhookRoute({ onEvent, verify });
    const response = await handler(
      new Request("https://example.com/api/sumit/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when handler throws but does not leak the error", async () => {
    const handler = createSumitWebhookRoute({
      onEvent: () => {
        throw new Error("db is down");
      },
    });
    const response = await handler(
      new Request("https://example.com/api/sumit/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.error).toBe("Handler failed");
    expect(JSON.stringify(json)).not.toContain("db is down");
  });
});

describe("verifySumitSharedSecret", () => {
  it("accepts the secret from the configured header", async () => {
    const verifier = verifySumitSharedSecret("s3cret");
    const ok = await verifier(
      new Request("https://example.com/", { method: "POST", headers: { "x-sumit-secret": "s3cret" } }),
    );
    expect(ok).toBe(true);
  });

  it("rejects query-param secrets by default", async () => {
    const verifier = verifySumitSharedSecret("s3cret");
    const ok = await verifier(new Request("https://example.com/?secret=s3cret", { method: "POST" }));
    expect(ok).toBe(false);
  });

  it("accepts the secret from a query param only when explicitly configured", async () => {
    const verifier = verifySumitSharedSecret("s3cret", { queryParam: "k" });
    const ok = await verifier(new Request("https://example.com/?k=s3cret", { method: "POST" }));
    expect(ok).toBe(true);
  });

  it("normalizes multipart form-data payloads", async () => {
    const onEvent = vi.fn();
    const handler = createSumitWebhookRoute({ onEvent });
    const body = new FormData();
    body.set("Payment.Status", "000");
    body.set("Payment.ValidPayment", "true");
    body.set("Payment.ID", "p1");
    body.set("RecurringCustomerItemIDs[0]", "444");

    const response = await handler(new Request("https://example.com/api/sumit/webhook", { method: "POST", body }));

    expect(response.status).toBe(200);
    const [event] = onEvent.mock.calls[0] as [{ eventType: string; paymentId?: string }];
    expect(event.eventType).toBe("recurring.charged");
    expect(event.paymentId).toBe("p1");
  });

  it("rejects mismatching secrets", async () => {
    const verifier = verifySumitSharedSecret("s3cret");
    const ok = await verifier(
      new Request("https://example.com/", { method: "POST", headers: { "x-sumit-secret": "wrong" } }),
    );
    expect(ok).toBe(false);
  });

  it("rejects candidates of different lengths without leaking via early return", async () => {
    const verifier = verifySumitSharedSecret("super-secret-value");
    // A short and a long wrong candidate must both reject. The comparison
    // hashes both inputs, so neither returns synchronously on length mismatch.
    const short = await verifier(
      new Request("https://example.com/", { method: "POST", headers: { "x-sumit-secret": "x" } }),
    );
    const long = await verifier(
      new Request("https://example.com/", {
        method: "POST",
        headers: { "x-sumit-secret": "x".repeat(1024) },
      }),
    );
    expect(short).toBe(false);
    expect(long).toBe(false);
  });
});
