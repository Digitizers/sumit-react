import { describe, expect, it, vi } from "vitest";

import { createSumitChargeRoute } from "./createChargeRoute.js";

const validBody = {
  singleUseToken: "tok_abc",
  customer: {
    externalIdentifier: "org_123",
    name: "Acme Ltd",
    emailAddress: "billing@example.com",
  },
  item: {
    name: "Pro",
    description: "Pro monthly",
    unitPrice: 19,
    currency: "USD" as const,
    durationMonths: 1,
  },
};

function jsonRequest(body: unknown): Request {
  return new Request("https://example.com/api/sumit/charge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createSumitChargeRoute", () => {
  it("returns 400 when body is invalid JSON", async () => {
    const handler = createSumitChargeRoute({ companyId: 1, apiKey: "k" });
    const response = await handler(
      new Request("https://example.com/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const handler = createSumitChargeRoute({ companyId: 1, apiKey: "k" });
    const response = await handler(jsonRequest({ singleUseToken: "tok" }));
    expect(response.status).toBe(400);
  });

  it("forwards a built payload to the SUMIT base URL and normalizes the response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ Payment: { ValidPayment: true, Status: "000" }, RecurringCustomerItemIDs: ["444"], CustomerID: "1", DocumentID: "9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onResult = vi.fn();
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch, onResult });

    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.eventType).toBe("recurring.charged");
    expect(json.ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sumit.co.il/billing/recurring/charge/");
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body as string) as { Credentials: { CompanyID: number; APIKey: string }; SingleUseToken: string };
    expect(sentBody.Credentials).toEqual({ CompanyID: 7, APIKey: "k" });
    expect(sentBody.SingleUseToken).toBe("tok_abc");

    expect(onResult).toHaveBeenCalledOnce();
  });

  it("returns 402 when SUMIT reports a failure", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ Payment: { ValidPayment: false, Status: "001" }, UserErrorMessage: "כרטיס נדחה" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(402);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.eventType).toBe("payment.failed");
    expect(json.ok).toBe(false);
  });

  it("returns 502 when the upstream call throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network");
    });
    const onError = vi.fn();
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch, onError });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(502);
    expect(onError).toHaveBeenCalledOnce();
  });
});
