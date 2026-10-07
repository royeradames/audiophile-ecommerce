import { z } from "zod";
import { getProduct, products } from "./catalog";
import { checkoutTotals, usdToCents } from "./checkout-totals";

const MAX_BODY_BYTES = 16_384;
const paymentRequestSchema = z.strictObject({
  orderId: z.string().trim().regex(/^AUD-[A-Z0-9-]{1,64}$/),
  email: z.email().max(254),
  items: z.array(z.strictObject({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(products.length),
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

function invalidRequest(error: string, status = 400) {
  return { ok: false as const, error, status };
}

export async function readPaymentRequest(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return invalidRequest("Send payment details as JSON.", 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return invalidRequest("Payment details are too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return invalidRequest("Payment details are required.");

  let payload: unknown;
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
        return invalidRequest("Payment details are too large.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    payload = JSON.parse(text + decoder.decode());
  } catch {
    return invalidRequest("Payment details must contain valid JSON.");
  } finally {
    reader.releaseLock();
  }

  const parsed = paymentRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidRequest("Send an order ID, email, and product quantities from 1 to 99. Prices and totals are calculated by the store.");
  }
  const { orderId, email, items } = parsed.data;
  const seen = new Set<string>();
  let subtotal = 0;
  const descriptions: string[] = [];
  for (const item of items) {
    const product = getProduct(item.productId);
    if (!product || seen.has(item.productId)) {
      return invalidRequest("Choose each product once from the current catalog.");
    }
    seen.add(item.productId);
    subtotal += product.price * item.quantity;
    descriptions.push(`${item.quantity}× ${product.shortName}`);
  }
  const amount = checkoutTotals(subtotal).grandTotal;
  const amountCents = usdToCents(amount);
  // Stripe accepts at most eight digits for a USD amount in cents.
  if (!Number.isSafeInteger(amountCents) || amountCents < 50 || amountCents > 99_999_999) {
    return invalidRequest("This cart exceeds the card payment limit. Reduce its quantities.");
  }
  return { ok: true as const, orderId, email, amount, amountCents, description: descriptions.join(", ") };
}
