"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PaymentInstructions } from "../payment-instructions";
import { usePayeeSettings } from "../payee-context";
import { ZelleQr } from "../zelle-qr";

export default function ZellePage() {
  const { settings } = usePayeeSettings();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [amount, setAmount] = useState("Amount from your order");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      const params = new URLSearchParams(window.location.search);
      setOrderId(params.get("order"));
      const nextAmount = params.get("amount");
      if (nextAmount) {
        setAmount(nextAmount);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="zelle-page section" aria-labelledby="zelle-title">
      <div className="container">
        <p className="overline overline-accent">US transfer</p>
        <div className="zelle-intro">
          <div>
            <h1 id="zelle-title">Pay with Zelle</h1>
            <p>
              Scan the official Zelle code, confirm the name reads{" "}
              {settings.zelle.name}, send the amount, and put the order ID in
              the memo. Nothing is marked paid until the transfer is matched by
              hand.
            </p>
          </div>
          <Link className="button button-outline" href="/checkout">
            Back to checkout
          </Link>
        </div>

        <div className="zelle-poster">
          <div className="zelle-qr-frame">
            <ZelleQr label={`Zelle QR for ${settings.zelle.name}`} />
            <p className="zelle-qr-caption">
              <strong>{settings.zelle.name}</strong>
              Confirm this name in your bank app before you send.
            </p>
          </div>

          <div className="zelle-copy">
            <ol className="zelle-steps">
              <li>Open Zelle in your US bank app. Choose Send, then the QR scanner.</li>
              <li>Scan this page. Confirm the name reads {settings.zelle.name}.</li>
              <li>Send the amount. Put the order ID in the memo.</li>
            </ol>
            <PaymentInstructions
              method="zelle"
              amount={amount}
              orderId={orderId}
              payee={settings}
              showQr={false}
              showPageLink={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
