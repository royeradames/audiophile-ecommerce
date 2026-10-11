import { z } from "zod";
import { getProduct, products } from "./catalog";
import { checkoutTotals, usdToCents } from "./checkout-totals";

const MAX_BODY_BYTES = 16_384;

export const cartItemsSchema = z.array(z.strictObject({
  productId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(99),
})).min(1).max(products.length);

const paymentRequestSchema = z.strictObject({
  orderId: z.string().trim().regex(/^AUD-[A-Z0-9-]{1,64}$/),
  // Optional: it only prefills Stripe's fields. The store never keeps it.
  email: z.email().max(254).optional(),
  items: cartItemsSchema,
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;
export type CartItems = z.infer<typeof cartItemsSchema>;

export function invalidRequest(error: string, status = 400) {
  return { ok: false as const, error, status };
}

export type PricedLine = { productId: string; name: string; quantity: number; unitPrice: number };

/**
 * Prices a cart from the server catalog: whole-dollar prices, the flat demo
 * shipping fee, with the brief's 20% VAT included. The browser never supplies a price.
 */
export function priceCart(items: CartItems) {
  const seen = new Set<string>();
  const lines: PricedLine[] = [];
  for (const item of items) {
    const product = getProduct(item.productId);
    if (!product || seen.has(item.productId)) {
      return invalidRequest("Choose each product once from the current catalog.");
    }
    seen.add(item.productId);
    lines.push({ productId: product.productId, name: product.shortName, quantity: item.quantity, unitPrice: product.price });
  }
  const totals = checkoutTotals(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  const amountCents = usdToCents(totals.grandTotal);
  // Stripe accepts at most eight digits for a USD amount in cents.
  if (!Number.isSafeInteger(amountCents) || amountCents < 50 || amountCents > 99_999_999) {
    return invalidRequest("This cart exceeds the card payment limit. Reduce its quantities.");
  }
  return {
    ok: true as const,
    lines,
    totals,
    amountCents,
    description: lines.map((line) => `${line.quantity}× ${line.name}`).join(", "),
  };
}

/** Reads a bounded JSON body. Oversized or malformed bodies become safe errors. */
export async function readJsonBody(request: Request, subject: string) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return invalidRequest(`Send ${subject} as JSON.`, 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return invalidRequest(`${capitalize(subject)} are too large.`, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return invalidRequest(`${capitalize(subject)} are required.`);

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return invalidRequest(`${capitalize(subject)} are too large.`, 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return { ok: true as const, payload: JSON.parse(text + decoder.decode()) as unknown };
  } catch {
    return invalidRequest(`${capitalize(subject)} must contain valid JSON.`);
  } finally {
    reader.releaseLock();
  }
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function readPaymentRequest(request: Request) {
  const body = await readJsonBody(request, "payment details");
  if (!body.ok) return body;

  const parsed = paymentRequestSchema.safeParse(body.payload);
  if (!parsed.success) {
    return invalidRequest("Send an order ID and product quantities from 1 to 99. Prices and totals are calculated by the store.");
  }
  const { orderId, email, items } = parsed.data;
  const priced = priceCart(items);
  if (!priced.ok) return priced;
  return {
    ok: true as const,
    orderId,
    email,
    items,
    amount: priced.totals.grandTotal,
    amountCents: priced.amountCents,
    description: priced.description,
  };
}
