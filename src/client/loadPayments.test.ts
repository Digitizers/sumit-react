import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSingleUseToken, loadSumitPayments, resetSumitPaymentsLoaderForTesting } from "./loadPayments.js";

let appended: HTMLScriptElement[] = [];

beforeEach(() => {
  appended = [];
  vi.spyOn(document.head, "appendChild").mockImplementation(function (this: HTMLHeadElement, node: Node) {
    if (node instanceof HTMLScriptElement) appended.push(node);
    return node;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSumitPaymentsLoaderForTesting();
  if (window.OfficeGuy) delete window.OfficeGuy;
});

describe("loadSumitPayments", () => {
  it("appends the script with the production URL and resolves with the SDK on load", async () => {
    const promise = loadSumitPayments("production");
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("https://app.sumit.co.il/scripts/payments.js");
    expect(appended[0].id).toBe("sumit-payments-script-production");

    window.OfficeGuy = { Payments: { CreateToken: () => false } };
    appended[0].dispatchEvent(new Event("load"));

    await expect(promise).resolves.toMatchObject({ CreateToken: expect.any(Function) });
  });

  it("uses the dev URL when environment is dev", () => {
    void loadSumitPayments("dev");
    expect(appended[0].src).toBe("http://dev.sumit.co.il/scripts/payments.js");
    expect(appended[0].id).toBe("sumit-payments-script-dev");
  });

  it("returns the cached SDK without re-appending on subsequent calls", async () => {
    const first = loadSumitPayments("production");
    window.OfficeGuy = { Payments: { CreateToken: () => false } };
    appended[0].dispatchEvent(new Event("load"));
    await first;

    const second = loadSumitPayments("production");
    await expect(second).resolves.toBeDefined();
    expect(appended).toHaveLength(1);
  });

  it("rejects when the script errors and clears the cache so callers can retry", async () => {
    const promise = loadSumitPayments("production");
    appended[0].dispatchEvent(new Event("error"));
    await expect(promise).rejects.toThrow(/Failed to load/);

    void loadSumitPayments("production");
    expect(appended).toHaveLength(2);
  });
});

describe("createSingleUseToken", () => {
  it("rejects when CreateToken returns synchronously", async () => {
    window.OfficeGuy = { Payments: { CreateToken: () => true } };
    const form = document.createElement("form");
    await expect(createSingleUseToken({ FormSelector: form, CompanyID: 1, APIPublicKey: "pk" })).rejects.toThrow(/synchronously/);
  });

  it("resolves with the token via the Callback", async () => {
    window.OfficeGuy = {
      Payments: {
        CreateToken: ({ Callback }) => {
          queueMicrotask(() => Callback("tok_xyz"));
          return false;
        },
      },
    };
    const form = document.createElement("form");
    await expect(createSingleUseToken({ FormSelector: form, CompanyID: 1, APIPublicKey: "pk" })).resolves.toBe("tok_xyz");
  });

  it("rejects when the Callback receives null", async () => {
    window.OfficeGuy = {
      Payments: {
        CreateToken: ({ Callback }) => {
          queueMicrotask(() => Callback(null));
          return false;
        },
      },
    };
    const form = document.createElement("form");
    await expect(createSingleUseToken({ FormSelector: form, CompanyID: 1, APIPublicKey: "pk" })).rejects.toThrow(/no token/);
  });
});
