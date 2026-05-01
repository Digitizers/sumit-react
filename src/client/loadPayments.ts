export type SumitEnvironment = "production" | "dev";

export interface SumitPaymentsCreateTokenSettings {
  FormSelector: HTMLFormElement | string;
  CompanyID: number;
  APIPublicKey: string;
  Environment?: SumitEnvironment;
  ResponseLanguage?: string;
  Callback: (token: string | null) => void;
}

export interface SumitPaymentsSdk {
  CreateToken: (settings: SumitPaymentsCreateTokenSettings) => boolean;
}

declare global {
  interface Window {
    OfficeGuy?: {
      Payments?: SumitPaymentsSdk;
    };
  }
}

const SCRIPT_URLS: Record<SumitEnvironment, string> = {
  production: "https://app.sumit.co.il/scripts/payments.js",
  dev: "http://dev.sumit.co.il/scripts/payments.js",
};

const SCRIPT_ID_PREFIX = "sumit-payments-script-";

const loaders = new Map<SumitEnvironment, Promise<SumitPaymentsSdk>>();

export function loadSumitPayments(environment: SumitEnvironment = "production"): Promise<SumitPaymentsSdk> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("loadSumitPayments must be called in a browser environment"));
  }

  const cached = loaders.get(environment);
  if (cached) return cached;

  const promise = new Promise<SumitPaymentsSdk>((resolve, reject) => {
    if (window.OfficeGuy?.Payments) {
      resolve(window.OfficeGuy.Payments);
      return;
    }

    const scriptId = `${SCRIPT_ID_PREFIX}${environment}`;
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");

    const handleLoad = () => {
      const sdk = window.OfficeGuy?.Payments;
      if (sdk) resolve(sdk);
      else reject(new Error("SUMIT payments.js loaded but OfficeGuy.Payments is not defined"));
    };
    const handleError = () => reject(new Error(`Failed to load SUMIT payments.js (${environment})`));

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existing) {
      script.id = scriptId;
      script.src = SCRIPT_URLS[environment];
      script.async = true;
      document.head.appendChild(script);
    }
  });

  promise.catch(() => loaders.delete(environment));
  loaders.set(environment, promise);
  return promise;
}

export function createSingleUseToken(settings: Omit<SumitPaymentsCreateTokenSettings, "Callback"> & { environment?: SumitEnvironment }): Promise<string> {
  const { environment = settings.Environment ?? "production", ...rest } = settings;
  return loadSumitPayments(environment).then(
    (sdk) =>
      new Promise<string>((resolve, reject) => {
        const callback = (token: string | null) => {
          if (token) resolve(token);
          else reject(new Error("SUMIT tokenization failed (no token returned)"));
        };
        const synchronous = sdk.CreateToken({ ...rest, Environment: environment, Callback: callback });
        if (synchronous) {
          reject(new Error("SUMIT tokenization returned synchronously without a token (form may be invalid)"));
        }
      }),
  );
}

export function resetSumitPaymentsLoaderForTesting(): void {
  loaders.clear();
}
