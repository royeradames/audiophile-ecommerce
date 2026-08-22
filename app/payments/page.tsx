"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PaymentInstructions } from "../payment-instructions";
import { usePayeeSettings } from "../payee-context";
import type { PayeeSettings } from "../payee-settings";
import { fetchStripeConfig } from "../stripe-client";
import type { StripePublicConfig } from "../stripe-env";

const methodCards = [
  {
    name: "Hosted card",
    status: "Stripe test",
    detail: "Stripe Checkout redirect in test mode. Live AZUL Link is after affiliation. No PayPal.",
  },
  {
    name: "Own card form",
    status: "Stripe test",
    detail: "Stripe Payment Element on the confirmation page. Card numbers stay on Stripe.",
  },
  {
    name: "DR bank transfer",
    status: "Dev test",
    detail: "Banreservas and Banco Popular. Human match on order ID. Edit the accounts below.",
  },
  {
    name: "Zelle",
    status: "QR page",
    detail: "Official bank QR on /zelle. Optional email or mobile is only a copy fallback.",
  },
  {
    name: "Pay in person",
    status: "Santo Domingo · Santiago",
    detail: "Dedicated AZUL wireless terminal. Ask affiliation for pickup and delivery.",
  },
] as const;

const azulSteps = [
  { id: "app", label: "Installed App AZUL on iPhone or iPad" },
  { id: "afiliarme", label: "Started Afiliarme as persona física, not a company" },
  { id: "link", label: "Asked for Link de Pagos" },
  { id: "terminal", label: "Asked for a terminal inalámbrica" },
  { id: "delivery", label: "Asked for pickup and delivery in Santo Domingo and Santiago" },
] as const;

const AZUL_STORAGE_KEY = "audiophile-azul-checklist-v1";

export default function PaymentsPage() {
  const { settings, saveSettings, restoreMockSettings } = usePayeeSettings();
  const [draft, setDraft] = useState<PayeeSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [stripe, setStripe] = useState<StripePublicConfig | null>(null);
  const [azul, setAzul] = useState<Record<string, boolean>>({});
  const current = draft ?? settings;

  useEffect(() => {
    void fetchStripeConfig().then(setStripe);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      try {
        const savedAzul = window.localStorage.getItem(AZUL_STORAGE_KEY);
        if (savedAzul) {
          setAzul(JSON.parse(savedAzul) as Record<string, boolean>);
        }
      } catch {
        window.localStorage.removeItem(AZUL_STORAGE_KEY);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateDraft(next: PayeeSettings) {
    setDraft(next);
    setSaved(false);
  }

  function updateBank(id: PayeeSettings["banks"][number]["id"], patch: Partial<PayeeSettings["banks"][number]>) {
    updateDraft({
      ...current,
      banks: [
        current.banks[0].id === id ? { ...current.banks[0], ...patch } : current.banks[0],
        current.banks[1].id === id ? { ...current.banks[1], ...patch } : current.banks[1],
      ],
    });
  }

  return (
    <section className="stack-page section" aria-labelledby="stack-title">
      <div className="container">
        <p className="overline overline-accent">Dev test</p>
        <div className="stack-intro">
          <div>
            <h1 id="stack-title">Payment stack</h1>
            <p>
              This is the store’s payment option stack. Checkout reads these
              details from this browser. Software first: mock Banreservas,
              Banco Popular, and Zelle here, then replace the numbers when a
              live account exists.
            </p>
          </div>
          <div className="stack-intro-actions">
            <Link className="button button-outline" href="/orders">
              Pending orders
            </Link>
            <Link className="button button-outline" href="/checkout">
              Open checkout
            </Link>
          </div>
        </div>

        <ul className="stack-methods">
          {methodCards.map((method) => (
            <li key={method.name}>
              <p className="stack-status">{method.status}</p>
              <h2>{method.name}</h2>
              <p>{method.detail}</p>
            </li>
          ))}
        </ul>

        <div className="stack-editor azul-panel">
          <h2>Stripe test and AZUL affiliation</h2>
          <p className="stack-hint">
            Stripe test keys:{" "}
            {stripe?.blocked === "live"
              ? "blocked because a live key was set. Use sk_test_ / pk_test_ only."
              : stripe?.configured
                ? "configured. Open checkout, choose Hosted card or Own card form, and use Stripe test cards only."
                : "not set. Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY, then restart."}{" "}
            Webhook endpoint: <code>/api/stripe/webhook</code>.
          </p>
          <p className="stack-hint">
            AZUL cannot be completed in code. File as persona física in App AZUL.
            Do not land AZUL Link in the same change as a new Stripe test wiring
            once a live merchant exists.{" "}
            <a href="https://www.azul.com.do/Pages/es/app-azul.aspx">App AZUL</a>
            {" · "}
            <a href="https://www.azul.com.do/Pages/es/evoluciona-con-azul.aspx">Evoluciona con AZUL</a>
          </p>
          <ul className="azul-checklist">
            {azulSteps.map((step) => (
              <li key={step.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(azul[step.id])}
                    onChange={(event) => {
                      const next = { ...azul, [step.id]: event.target.checked };
                      setAzul(next);
                      window.localStorage.setItem(AZUL_STORAGE_KEY, JSON.stringify(next));
                    }}
                  />
                  {step.label}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="stack-layout">
          <form
            className="stack-editor"
            onSubmit={(event) => {
              event.preventDefault();
              saveSettings(current);
              setDraft(null);
              setSaved(true);
            }}
          >
            <fieldset>
              <legend>Payee identity</legend>
              <p className="stack-hint">AZUL affiliation is persona física. Use the legal name and cédula, not a company RNC.</p>
              <div className="form-grid">
                <label className="form-field field-wide" htmlFor="beneficiary">
                  <span>Beneficiary</span>
                  <input
                    id="beneficiary"
                    value={current.beneficiary}
                    autoComplete="name"
                    onChange={(event) =>
                      updateDraft({ ...current, beneficiary: event.target.value })
                    }
                  />
                </label>
                <label className="form-field" htmlFor="taxId">
                  <span>Cédula</span>
                  <input
                    id="taxId"
                    value={current.taxId}
                    autoComplete="off"
                    onChange={(event) =>
                      updateDraft({ ...current, taxId: event.target.value })
                    }
                  />
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Dominican banks</legend>
              <p className="stack-hint">Both banks stay available. Update either account without removing the other.</p>
              <div className="stack-banks">
                {current.banks.map((bank) => (
                  <div className="stack-bank" key={bank.id}>
                    <h3>{bank.bank}</h3>
                    <label className="form-field" htmlFor={`${bank.id}-account`}>
                      <span>Account number</span>
                      <input
                        id={`${bank.id}-account`}
                        value={bank.account}
                        autoComplete="off"
                        onChange={(event) => updateBank(bank.id, { account: event.target.value })}
                      />
                    </label>
                    <label className="form-field" htmlFor={`${bank.id}-type`}>
                      <span>Account type</span>
                      <input
                        id={`${bank.id}-type`}
                        value={bank.type}
                        autoComplete="off"
                        onChange={(event) => updateBank(bank.id, { type: event.target.value })}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Zelle</legend>
              <p className="stack-hint">
                The Zelle page shows the official bank QR for Royer Adames.
                Name and optional email or mobile below are the copy fallback
                if a bank cannot scan. <Link href="/zelle">Open the Zelle page</Link>.
              </p>
              <div className="form-grid">
                <label className="form-field" htmlFor="zelle-name">
                  <span>Zelle name</span>
                  <input
                    id="zelle-name"
                    value={current.zelle.name}
                    autoComplete="off"
                    onChange={(event) =>
                      updateDraft({
                        ...current,
                        zelle: { ...current.zelle, name: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="form-field" htmlFor="zelle-handle">
                  <span>Email or US mobile</span>
                  <input
                    id="zelle-handle"
                    value={current.zelle.handle}
                    autoComplete="off"
                    onChange={(event) =>
                      updateDraft({
                        ...current,
                        zelle: { ...current.zelle, handle: event.target.value },
                      })
                    }
                  />
                </label>
              </div>
            </fieldset>

            <div className="stack-actions">
              <button className="button button-primary" type="submit">
                Save payee details
              </button>
              <button
                className="button button-outline"
                type="button"
                onClick={() => {
                  setDraft(null);
                  restoreMockSettings();
                  setSaved(true);
                }}
              >
                Restore mock defaults
              </button>
              {saved ? (
                <p className="stack-saved" aria-live="polite">
                  Saved in this browser. Checkout will use these details.
                </p>
              ) : null}
            </div>
          </form>

          <aside className="stack-preview" aria-labelledby="preview-title">
            <p className="stack-status">Sample customer view</p>
            <h2 id="preview-title">Transfer instructions</h2>
            <p className="stack-hint">
              Layout only. Amount and order ID come from checkout. Do not send
              money to these mock numbers.
            </p>
            <PaymentInstructions
              method="transfer"
              amount="Amount from checkout"
              orderId={null}
              payee={current}
            />
          </aside>
        </div>
      </div>
    </section>
  );
}
