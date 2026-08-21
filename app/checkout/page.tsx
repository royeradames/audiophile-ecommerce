"use client";

/* eslint-disable @next/next/no-img-element */

import { AnyFieldApi, useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { formatPrice, getProduct } from "../catalog";
import { useCart } from "../cart-context";

const fieldOrder = [
  "name",
  "email",
  "phone",
  "address",
  "zip",
  "city",
  "country",
  "emoneyNumber",
  "pin",
] as const;

const fields = [
  { name: "name", label: "Name", type: "text", autoComplete: "name", placeholder: "Alex Morgan" },
  { name: "email", label: "Email address", type: "email", autoComplete: "email", placeholder: "alex@example.com" },
  { name: "phone", label: "Phone number", type: "tel", autoComplete: "tel", placeholder: "+1 202 555 0148" },
  { name: "address", label: "Address", type: "text", autoComplete: "street-address", placeholder: "1137 Sound Avenue", wide: true },
  { name: "zip", label: "ZIP code", type: "text", autoComplete: "postal-code", placeholder: "10001" },
  { name: "city", label: "City", type: "text", autoComplete: "address-level2", placeholder: "New York" },
  { name: "country", label: "Country", type: "text", autoComplete: "country-name", placeholder: "United States" },
] as const;

const emoneyNumberField = {
  name: "emoneyNumber",
  label: "Demo e-Money number",
  type: "text",
  autoComplete: "off",
  placeholder: "123456789",
} as const;

const pinField = {
  name: "pin",
  label: "Demo PIN",
  type: "password",
  autoComplete: "off",
  placeholder: "1234",
} as const;

function requiredText(label: string) {
  return z.string().refine((value) => value.trim().length > 0, {
    error: `${label} is required.`,
  });
}

const checkoutSchema = z
  .object({
    name: requiredText("Name"),
    email: z.string().superRefine((value, ctx) => {
      if (!value.trim()) {
        ctx.addIssue({ code: "custom", message: "Email address is required." });
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(value)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
      }
    }),
    phone: requiredText("Phone number"),
    address: requiredText("Address"),
    zip: requiredText("ZIP code"),
    city: requiredText("City"),
    country: requiredText("Country"),
    payment: z.enum(["emoney", "cash"]),
    emoneyNumber: z.string(),
    pin: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.payment !== "emoney") return;
    if (!/^\d{9}$/.test(value.emoneyNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["emoneyNumber"],
        message: "Use the nine-digit demo number 123456789.",
      });
    }
    if (!/^\d{4}$/.test(value.pin)) {
      ctx.addIssue({
        code: "custom",
        path: ["pin"],
        message: "Use any four-digit demo PIN.",
      });
    }
  });

type CheckoutValues = z.input<typeof checkoutSchema>;

const defaultValues: CheckoutValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  zip: "",
  city: "",
  country: "",
  payment: "emoney",
  emoneyNumber: "",
  pin: "",
};

function fieldErrorMessage(errors: unknown[]): string | undefined {
  for (const error of errors) {
    if (!error) continue;
    if (typeof error === "string") return error;
    if (Array.isArray(error)) {
      const nested = fieldErrorMessage(error);
      if (nested) return nested;
    } else if (typeof error === "object" && "message" in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
}

export default function CheckoutPage() {
  const { items, clearCart } = useCart();
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

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: checkoutSchema,
    },
    onSubmit: () => {
      setConfirmedTotal(grandTotal);
      clearCart();
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    onSubmitInvalid: ({ formApi }) => {
      const firstError = fieldOrder.find((name) => {
        const meta = formApi.getFieldMeta(name);
        return Boolean(meta?.errors.length);
      });
      if (firstError) {
        requestAnimationFrame(() => document.getElementById(firstError)?.focus());
      }
    },
  });

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
          <form
            id="checkout-form"
            className="checkout-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <div className="checkout-intro">
              <p className="overline overline-accent">Fictional demo</p>
              <h1 id="checkout-title">Checkout</h1>
              <p>Nothing is charged or sent. Use fictional contact and payment details only.</p>
            </div>

            <fieldset>
              <legend>Billing details</legend>
              <div className="form-grid">
                {fields.slice(0, 3).map((field) => (
                  <form.Field key={field.name} name={field.name}>
                    {(api) => <FormField field={api} spec={field} />}
                  </form.Field>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Shipping info</legend>
              <div className="form-grid">
                {fields.slice(3).map((field) => (
                  <form.Field key={field.name} name={field.name}>
                    {(api) => <FormField field={api} spec={field} />}
                  </form.Field>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Payment details</legend>
              <form.Field name="payment">
                {(field) => (
                  <>
                    <div className="payment-options" role="radiogroup" aria-label="Payment method">
                      <label className={field.state.value === "emoney" ? "selected" : ""}>
                        <input
                          type="radio"
                          name={field.name}
                          value="emoney"
                          checked={field.state.value === "emoney"}
                          onBlur={field.handleBlur}
                          onChange={() => field.handleChange("emoney")}
                        />
                        Demo e-Money
                      </label>
                      <label className={field.state.value === "cash" ? "selected" : ""}>
                        <input
                          type="radio"
                          name={field.name}
                          value="cash"
                          checked={field.state.value === "cash"}
                          onBlur={field.handleBlur}
                          onChange={() => field.handleChange("cash")}
                        />
                        Cash on delivery
                      </label>
                    </div>
                    {field.state.value === "emoney" ? (
                      <div className="form-grid payment-fields">
                        <form.Field name={emoneyNumberField.name}>
                          {(api) => <FormField field={api} spec={emoneyNumberField} />}
                        </form.Field>
                        <form.Field name={pinField.name}>
                          {(api) => <FormField field={api} spec={pinField} />}
                        </form.Field>
                      </div>
                    ) : (
                      <p className="payment-note">You’ll receive a fictional confirmation now. No delivery or payment is created.</p>
                    )}
                  </>
                )}
              </form.Field>
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
  spec,
}: {
  field: AnyFieldApi;
  spec: { name: string; label: string; type: string; autoComplete: string; placeholder: string; wide?: boolean };
}) {
  const error = fieldErrorMessage(field.state.meta.errors);

  return (
    <label className={`form-field ${spec.wide ? "field-wide" : ""}`} htmlFor={spec.name}>
      <span>{spec.label}</span>
      <input
        id={spec.name}
        name={field.name}
        type={spec.type}
        value={field.state.value}
        autoComplete={spec.autoComplete}
        placeholder={spec.placeholder}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${spec.name}-error` : undefined}
      />
      {error ? <small id={`${spec.name}-error`}>{error}</small> : null}
    </label>
  );
}
