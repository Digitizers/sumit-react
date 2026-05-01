import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";

import { loadSumitPayments } from "./loadPayments.js";
import type { SumitEnvironment, SumitPaymentsCreateTokenSettings } from "./loadPayments.js";

export interface SumitCheckoutLabels {
  cardNumber?: string;
  expirationMonth?: string;
  expirationYear?: string;
  cvv?: string;
  citizenId?: string;
}

export interface SumitCheckoutClassNames {
  form?: string;
  field?: string;
  label?: string;
  input?: string;
  select?: string;
  errors?: string;
}

export interface SumitCheckoutProps {
  companyId: number;
  apiPublicKey: string;
  environment?: SumitEnvironment;
  language?: string;

  requireCvv?: boolean;
  requireCitizenId?: boolean;

  labels?: SumitCheckoutLabels;
  classNames?: SumitCheckoutClassNames;
  style?: CSSProperties;

  onToken: (token: string) => void | Promise<void>;
  onError?: (error: Error) => void;
  onTokenizationStart?: () => void;
  onTokenizationEnd?: () => void;

  children?: ReactNode;
}

export interface SumitCheckoutHandle {
  submit: () => void;
  reset: () => void;
}

const DEFAULT_LABELS: Required<SumitCheckoutLabels> = {
  cardNumber: "מספר כרטיס",
  expirationMonth: "חודש",
  expirationYear: "שנה",
  cvv: "CVV",
  citizenId: "תעודת זהות",
};

export const SumitCheckout = forwardRef<SumitCheckoutHandle, SumitCheckoutProps>(function SumitCheckout(
  props,
  ref,
) {
  const {
    companyId,
    apiPublicKey,
    environment = "production",
    language,
    requireCvv = true,
    requireCitizenId = false,
    labels,
    classNames,
    style,
    onToken,
    onError,
    onTokenizationStart,
    onTokenizationEnd,
    children,
  } = props;

  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const mergedLabels = { ...DEFAULT_LABELS, ...labels };

  const finishSubmitting = useCallback(() => {
    submittingRef.current = false;
    setSubmitting(false);
  }, []);

  const tokenize = useCallback(async () => {
    const form = formRef.current;
    // Ref check is synchronous and immune to React's batched state updates,
    // closing the window where two rapid clicks both pass the guard.
    if (!form || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    onTokenizationStart?.();

    try {
      const sdk = await loadSumitPayments(environment);
      const tokenInput = form.querySelector<HTMLInputElement>('input[name="og-token"]');
      if (tokenInput) tokenInput.value = "";

      const settings: SumitPaymentsCreateTokenSettings = {
        FormSelector: form,
        CompanyID: companyId,
        APIPublicKey: apiPublicKey,
        Environment: environment,
        ResponseLanguage: language,
        Callback: (token) => {
          if (!token) {
            onError?.(new Error("SUMIT tokenization failed"));
            finishSubmitting();
            onTokenizationEnd?.();
            return;
          }
          Promise.resolve(onToken(token))
            .catch((error: unknown) => onError?.(error instanceof Error ? error : new Error(String(error))))
            .finally(() => {
              finishSubmitting();
              onTokenizationEnd?.();
            });
        },
      };

      const synchronous = sdk.CreateToken(settings);
      if (synchronous) {
        finishSubmitting();
        onTokenizationEnd?.();
        onError?.(new Error("SUMIT tokenization returned synchronously (form may be invalid)"));
      }
    } catch (error) {
      finishSubmitting();
      onTokenizationEnd?.();
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, [apiPublicKey, companyId, environment, language, onError, onToken, onTokenizationEnd, onTokenizationStart, finishSubmitting]);

  useImperativeHandle(
    ref,
    () => ({
      submit: () => {
        void tokenize();
      },
      reset: () => {
        formRef.current?.reset();
      },
    }),
    [tokenize],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void tokenize();
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 15 }, (_, i) => String(currentYear + i));

  const fieldClass = classNames?.field;
  const labelClass = classNames?.label;
  const inputClass = classNames?.input;
  const selectClass = classNames?.select ?? inputClass;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className={classNames?.form}
      style={style}
      data-sumit-checkout=""
      noValidate
    >
      <div className={fieldClass} data-sumit-field="card-number">
        <label className={labelClass} htmlFor="og-ccnum">{mergedLabels.cardNumber}</label>
        <input
          id="og-ccnum"
          name="og-ccnum"
          type="tel"
          inputMode="numeric"
          autoComplete="cc-number"
          maxLength={20}
          required
          disabled={submitting}
          className={inputClass}
        />
      </div>

      <div className={fieldClass} data-sumit-field="expiration">
        <label className={labelClass} htmlFor="og-expmonth">{mergedLabels.expirationMonth}</label>
        <select id="og-expmonth" name="og-expmonth" autoComplete="cc-exp-month" required disabled={submitting} className={selectClass}>
          <option value=""></option>
          {monthOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <label className={labelClass} htmlFor="og-expyear">{mergedLabels.expirationYear}</label>
        <select id="og-expyear" name="og-expyear" autoComplete="cc-exp-year" required disabled={submitting} className={selectClass}>
          <option value=""></option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {requireCvv ? (
        <div className={fieldClass} data-sumit-field="cvv">
          <label className={labelClass} htmlFor="og-cvv">{mergedLabels.cvv}</label>
          <input
            id="og-cvv"
            name="og-cvv"
            type="tel"
            inputMode="numeric"
            autoComplete="cc-csc"
            maxLength={4}
            required
            disabled={submitting}
            className={inputClass}
          />
        </div>
      ) : null}

      {requireCitizenId ? (
        <div className={fieldClass} data-sumit-field="citizen-id">
          <label className={labelClass} htmlFor="og-citizenid">{mergedLabels.citizenId}</label>
          <input
            id="og-citizenid"
            name="og-citizenid"
            type="tel"
            inputMode="numeric"
            maxLength={9}
            required
            disabled={submitting}
            className={inputClass}
          />
        </div>
      ) : null}

      <input id="og-token" name="og-token" type="hidden" defaultValue="" />

      {children}
    </form>
  );
});
