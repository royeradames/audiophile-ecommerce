export const DEMO_SHIPPING_USD = 50;
/** The brief's VAT rate. Catalog prices already include it. */
export const VAT_RATE = 0.2;
export const DEMO_USD_TO_DOP = 60;

export type CheckoutTotals = {
  subtotal: number;
  shipping: number;
  /** The VAT inside the subtotal, shown for information; never added on top. */
  vat: number;
  grandTotal: number;
};

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Demo checkout math from the Frontend Mentor brief. Catalog prices are USD
 * and include VAT, which is 20% of the product total, excluding shipping.
 * Shipping is a flat demo fee. Grand total = products + shipping. Neither
 * figure is a live tax filing.
 */
export function checkoutTotals(subtotal: number): CheckoutTotals {
  const safeSubtotal = subtotal > 0 ? subtotal : 0;
  const shipping = safeSubtotal > 0 ? DEMO_SHIPPING_USD : 0;
  return {
    subtotal: safeSubtotal,
    shipping,
    vat: Math.round(safeSubtotal * VAT_RATE),
    grandTotal: safeSubtotal + shipping,
  };
}

export function formatDopFromUsd(usd: number) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    maximumFractionDigits: 0,
  }).format(usd * DEMO_USD_TO_DOP);
}

export function usdToCents(usd: number) {
  return Math.round(usd * 100);
}
