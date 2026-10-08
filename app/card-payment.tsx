"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useEffect, useMemo, useState } from "react";
import { createPaymentIntent, fetchStripeConfig, fetchStripePaymentIntent } from "./stripe-client";
import type { PaymentRequest } from "./payment-request";
import { formatUsd } from "./checkout-totals";

type CardPaymentProps = PaymentRequest & {
  onPaid: () => void;
};

export function CardPayment(props: CardPaymentProps) {
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const config = await fetchStripeConfig();
      if (cancelled) {
        return;
      }
      if (config.blocked === "live") {
        setError("Live Stripe keys are blocked. Use sk_test_ / pk_test_ only.");
        return;
      }
      if (!config.configured || !config.publishableKey) {
        setError("Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (test mode) to .env.local or .dev.vars, then restart the server.");
        return;
      }
      const intent = await createPaymentIntent({
        orderId: props.orderId,
        items: props.items,
        email: props.email,
      });
      if (cancelled) {
        return;
      }
      if (!intent.ok) {
        setError(intent.error);
        return;
      }
      setPublishableKey(config.publishableKey);
      setClientSecret(intent.clientSecret);
      setAmount(intent.amount);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.items, props.email, props.orderId]);

  const stripePromise = useMemo(() => {
    if (!publishableKey) {
      return null;
    }
    return loadStripe(publishableKey) as Promise<Stripe | null>;
  }, [publishableKey]);

  if (error) {
    return <p className="stack-hint">{error}</p>;
  }
  if (!stripePromise || !clientSecret || amount === null) {
    return <p className="stack-hint">Preparing Stripe test card fields…</p>;
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: "stripe" },
      }}
    >
      <CardPaymentForm amount={amount} email={props.email} onPaid={props.onPaid} />
    </Elements>
  );
}

function CardPaymentForm({
  amount,
  email,
  onPaid,
}: {
  amount: number;
  email: string;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="card-payment"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!stripe || !elements || submitting) {
          return;
        }
        setSubmitting(true);
        setError(null);
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/checkout/stripe`,
          },
          redirect: "if_required",
        });
        if (result.error) {
          setError(result.error.message || "The test card was not charged.");
          setSubmitting(false);
          return;
        }
        const status = result.paymentIntent?.status;
        if (status === "succeeded") {
          // Tell the store now; the webhook may arrive later or, on a
          // protected preview, not at all. Recording is idempotent.
          await fetchStripePaymentIntent(result.paymentIntent.id).catch(() => null);
          onPaid();
          setSubmitting(false);
          return;
        }
        setError("The payment is still pending. Check /orders after Stripe confirms it.");
        setSubmitting(false);
      }}
    >
      <PaymentElement
        options={{
          layout: "tabs",
          defaultValues: { billingDetails: { email } },
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />
      {error ? <p className="stack-hint">{error}</p> : null}
      <button className="button button-primary button-block" type="submit" disabled={!stripe} aria-busy={submitting}>
        {submitting ? "Paying…" : `Pay ${formatUsd(amount)} (Stripe test)`}
      </button>
    </form>
  );
}
