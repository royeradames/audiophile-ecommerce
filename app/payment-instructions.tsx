"use client";

import Link from "next/link";
import { useState } from "react";
import type { PaymentMethod } from "./payment-methods";
import type { PayeeSettings } from "./payee-settings";
import { ZelleQr, zellePageHref } from "./zelle-qr";

export function PaymentInstructions({
  method,
  amount,
  orderId,
  payee,
  showQr = true,
  showPageLink = true,
}: {
  method: PaymentMethod;
  amount: string;
  orderId: string | null;
  payee: PayeeSettings;
  showQr?: boolean;
  showPageLink?: boolean;
}) {
  const reference = orderId ?? "AUD- assigned when you place the order";

  if (method === "hosted") {
    return (
      <p className="payment-note">
        Hosted card opens Stripe Checkout in test mode. Apple Pay and Google Pay
        appear when Stripe and the device support them. Do not type a card number
        into this form. Live AZUL is later, after affiliation.
      </p>
    );
  }

  if (method === "element") {
    return (
      <p className="payment-note">
        Own card form uses Stripe Payment Element. Card numbers stay on Stripe.
        This is test mode only, not a live Dominican card rail.
      </p>
    );
  }

  if (method === "transfer") {
    return (
      <div className="payment-note">
        <p>
          Dev test payee details. Update them on the payment stack. Do not send
          real money until these numbers match a live account.
        </p>
        <InstructionList
          rows={[
            { label: "Beneficiary", value: payee.beneficiary },
            { label: "Cédula", value: payee.taxId },
            ...payee.banks.map((bank) => ({
              label: `${bank.bank} account`,
              value: `${bank.account} (${bank.type})`,
            })),
            { label: "Amount", value: amount },
            { label: "Referencia", value: reference },
          ]}
        />
      </div>
    );
  }

  if (method === "zelle") {
    return (
      <div className="payment-note">
        {showQr ? (
          <div className="zelle-scan">
            <ZelleQr
              compact
              label={`Zelle QR for ${payee.zelle.name}`}
            />
            <p>
              Scan the official Zelle QR or copy the handle. Put the order ID in the memo.
            </p>
          </div>
        ) : (
          <p>
            Confirm the name in your bank app before you send. Put the order ID
            in the memo.
          </p>
        )}
        <InstructionList
          rows={[
            { label: "Zelle name", value: payee.zelle.name },
            ...(payee.zelle.handle
              ? [{ label: "Zelle handle", value: payee.zelle.handle }]
              : []),
            { label: "Amount", value: amount },
            { label: "Memo", value: reference },
          ]}
        />
        {showPageLink ? (
          <Link className="button button-outline" href={zellePageHref(orderId, amount)}>
            Open Zelle page
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <p className="payment-note">
      Pay on a dedicated AZUL wireless terminal in Santo Domingo or Santiago.
      Pickup and delivery are both on the affiliation ask. App AZUL on iPhone
      or iPad can send a payment link or QR. It cannot accept a tap on the
      Apple device.
    </p>
  );
}

function InstructionList({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <ul className="instruction-list">
      {rows.map((row) => (
        <li key={row.label}>
          <span>
            <strong>{row.label}</strong>
            {row.value}
          </span>
          <CopyButton label={row.label} value={row.value} />
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="copy-button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
