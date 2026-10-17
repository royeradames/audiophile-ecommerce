import * as z from "zod/mini";
import { orderStatuses, type OrderLine } from "./order-record";
import { paymentMethods } from "./payment-methods";

/** What this deployment offers. The guest-only Sites fallback has neither. */
export type StoreFeatures = {
  /** Always true: nothing is sold, charged for real or shipped. */
  demo: boolean;
  durableOrders: boolean;
  accounts: "enabled" | "coming_soon";
};

const pickupCitySchema = z.enum(["", "santo_domingo", "santiago"]);

/**
 * An order as the server stores it, without the shipping address. Order IDs
 * are long random receipts, so anyone holding one can check its status.
 */
export const orderSummarySchema = z.object({
  id: z.string().check(z.regex(/^AUD-[0-9A-HJKMNP-TV-Z]{10}$/)),
  status: z.enum(orderStatuses),
  payment: z.enum(paymentMethods),
  pickupCity: pickupCitySchema,
  createdAt: z.string(),
  settledAt: z.nullable(z.string()),
  lines: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    quantity: z.number().check(z.int(), z.positive()),
    unitPrice: z.number().check(z.nonnegative()),
  })).check(z.minLength(1)),
  subtotal: z.number().check(z.nonnegative()),
  shipping: z.number().check(z.nonnegative()),
  vat: z.number().check(z.nonnegative()),
  grandTotal: z.number().check(z.nonnegative()),
  savedToAccount: z.boolean(),
});

export type OrderSummary = z.infer<typeof orderSummarySchema> & { lines: OrderLine[] };

export const newOrderSchema = z.strictObject({
  requestKey: z.uuid(),
  payment: z.enum(paymentMethods),
  pickupCity: pickupCitySchema,
  // No customer details: this demo store never receives them. Checkout still
  // validates them in the browser so the form stays testable.
  items: z.array(z.strictObject({
    productId: z.string().check(z.minLength(1), z.maxLength(100)),
    quantity: z.number().check(z.int(), z.gte(1), z.lte(99)),
  })).check(z.minLength(1), z.maxLength(20)),
}).check(z.refine(
  (order) => (order.payment === "in_person") === (order.pickupCity !== ""),
  { message: "Choose a pickup city for pay in person, and only then." },
));

export type NewOrder = z.infer<typeof newOrderSchema>;
