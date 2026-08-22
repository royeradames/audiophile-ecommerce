export const DEMO_SHIPPING_USD = 50;
export const DEMO_ITBIS_RATE = 0.18;
export const DEMO_USD_TO_DOP = 60;

export type CheckoutTotals = {
  subtotal: number;
  shipping: number;
  tax: number;
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
 * Demo checkout math. Catalog prices are USD. Shipping is a flat demo fee.
 * Tax is 18% shaped like DR ITBIS, not a live filing or US sales tax.
 */
export function checkoutTotals(subtotal: number): CheckoutTotals {
  const safeSubtotal = subtotal > 0 ? subtotal : 0;
  const shipping = safeSubtotal > 0 ? DEMO_SHIPPING_USD : 0;
  const tax = Math.round(safeSubtotal * DEMO_ITBIS_RATE);
  return {
    subtotal: safeSubtotal,
    shipping,
    tax,
    grandTotal: safeSubtotal + shipping + tax,
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
