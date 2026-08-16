"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";
import { formatPrice, getProduct } from "../catalog";
import { useCart } from "../cart-context";

type FieldErrors = Record<string, string>;

const fields = [
  { name: "name", label: "Name", type: "text", autoComplete: "name", placeholder: "Alex Morgan" },
  { name: "email", label: "Email address", type: "email", autoComplete: "email", placeholder: "alex@example.com" },
  { name: "phone", label: "Phone number", type: "tel", autoComplete: "tel", placeholder: "+1 202 555 0148" },
  { name: "address", label: "Address", type: "text", autoComplete: "street-address", placeholder: "1137 Sound Avenue", wide: true },
  { name: "zip", label: "ZIP code", type: "text", autoComplete: "postal-code", placeholder: "10001" },
  { name: "city", label: "City", type: "text", autoComplete: "address-level2", placeholder: "New York" },
  { name: "country", label: "Country", type: "text", autoComplete: "country-name", placeholder: "United States" },
] as const;

export default function CheckoutPage() {
  const { items, clearCart } = useCart();
  const [payment, setPayment] = useState<"emoney" | "cash">("emoney");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const detailedItems = useMemo(
    () =>
      items.flatMap((line) => {
        const product = getProduct(line.productId);
        return product ? [{ ...line, product }] : [];
      }),
    [items],
  );
  const subtotal = detailedItems.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0,
  );
  const shipping = detailedItems.length ? 50 : 0;
  const vat = Math.round(subtotal * 0.2);
  const grandTotal = subtotal + shipping + vat;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextErrors: FieldErrors = {};
    for (const field of fields) {
      const value = String(data.get(field.name) || "").trim();
      if (!value) nextErrors[field.name] = `${field.label} is required.`;
    }
    const email = String(data.get("email") || "");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = "Enter a valid email address.";
    if (payment === "emoney") {
      if (!/^\d{9}$/.test(String(data.get("emoneyNumber") || ""))) {
        nextErrors.emoneyNumber = "Use the nine-digit demo number 123456789.";
      }
      if (!/^\d{4}$/.test(String(data.get("pin") || ""))) {
        nextErrors.pin = "Use any four-digit demo PIN.";
      }
    }
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)[0];
    if (firstError) {
      requestAnimationFrame(() => document.getElementById(firstError)?.focus());
      return;
    }
    setConfirmedTotal(grandTotal);
    clearCart();
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  if (!detailedItems.length && confirmedTotal === null) {
    return (
      <section className="checkout-page section">
        <div className="container narrow-empty">
          <p className="eyebrow">Checkout</p>
          <h1>Your cart is empty</h1>
          <p>Add a product before starting the demo checkout. Your cart is saved only in this browser.</p>
          <Link className="button button-primary" href="/headphones">Browse headphones</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="checkout-page section" aria-labelledby="checkout-title">
      <div className="container">
        <Link className="back-link" href="/">← Continue shopping</Link>
        <div className="checkout-layout">
          <form id="checkout-form" className="checkout-form" noValidate onSubmit={submit}>
            <div className="checkout-intro">
              <p className="overline overline-accent">Private demo</p>
              <h1 id="checkout-title">Checkout</h1>
              <p>Nothing is charged or sent. Use fictional contact and payment details only.</p>
            </div>

            <fieldset>
              <legend>Billing details</legend>
              <div className="form-grid">
                {fields.slice(0, 3).map((field) => (
                  <FormField key={field.name} field={field} error={errors[field.name]} />
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Shipping info</legend>
              <div className="form-grid">
                {fields.slice(3).map((field) => (
                  <FormField key={field.name} field={field} error={errors[field.name]} />
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Payment details</legend>
              <div className="payment-options" role="radiogroup" aria-label="Payment method">
                <label className={payment === "emoney" ? "selected" : ""}>
                  <input type="radio" name="payment" value="emoney" checked={payment === "emoney"} onChange={() => setPayment("emoney")} />
                  Demo e-Money
                </label>
                <label className={payment === "cash" ? "selected" : ""}>
                  <input type="radio" name="payment" value="cash" checked={payment === "cash"} onChange={() => setPayment("cash")} />
                  Cash on delivery
                </label>
              </div>
              {payment === "emoney" ? (
                <div className="form-grid payment-fields">
                  <FormField field={{ name: "emoneyNumber", label: "Demo e-Money number", type: "text", autoComplete: "off", placeholder: "123456789" }} error={errors.emoneyNumber} />
                  <FormField field={{ name: "pin", label: "Demo PIN", type: "password", autoComplete: "off", placeholder: "1234" }} error={errors.pin} />
                </div>
              ) : (
                <p className="payment-note">You’ll receive a fictional confirmation now. No delivery or payment is created.</p>
              )}
            </fieldset>

            <button className="button button-primary button-block mobile-order-button" type="submit">
              Place demo order · {formatPrice(grandTotal)}
            </button>
          </form>

          <aside className="order-summary" aria-labelledby="summary-title">
            <h2 id="summary-title">Summary</h2>
            <ul className="summary-list">
              {detailedItems.map(({ product, quantity }) => (
                <li key={product.productId}>
                  <img src={product.cartImage} alt="" width="72" height="72" />
                  <div><strong>{product.shortName}</strong><span>{formatPrice(product.price)}</span></div>
                  <span>×{quantity}</span>
                </li>
              ))}
            </ul>
            <dl className="totals">
              <div><dt>Subtotal</dt><dd>{formatPrice(subtotal)}</dd></div>
              <div><dt>Shipping</dt><dd>{formatPrice(shipping)}</dd></div>
              <div><dt>VAT (included for demo)</dt><dd>{formatPrice(vat)}</dd></div>
              <div className="grand-total"><dt>Grand total</dt><dd>{formatPrice(grandTotal)}</dd></div>
            </dl>
            <button className="button button-primary button-block desktop-order-button" type="submit" form="checkout-form">
              Place demo order
            </button>
          </aside>
        </div>
      </div>

      {confirmedTotal !== null ? (
        <div className="dialog-layer confirmation-layer">
          <section className="confirmation-panel" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
            <span className="confirmation-mark" aria-hidden="true">✓</span>
            <h2 id="confirmation-title" ref={headingRef} tabIndex={-1}>Thank you for listening.</h2>
            <p>Your demo order is complete. No payment was processed and no personal details were saved.</p>
            <div className="confirmation-total"><span>Demo total</span><strong>{formatPrice(confirmedTotal)}</strong></div>
            <Link className="button button-primary button-block" href="/" onClick={() => setConfirmedTotal(null)}>Back to home</Link>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function FormField({
  field,
  error,
}: {
  field: { name: string; label: string; type: string; autoComplete: string; placeholder: string; wide?: boolean };
  error?: string;
}) {
  return (
    <label className={`form-field ${field.wide ? "field-wide" : ""}`} htmlFor={field.name}>
      <span>{field.label}</span>
      <input
        id={field.name}
        name={field.name}
        type={field.type}
        autoComplete={field.autoComplete}
        placeholder={field.placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${field.name}-error` : undefined}
      />
      {error ? <small id={`${field.name}-error`}>{error}</small> : null}
    </label>
  );
}
