import { z } from "zod";
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
  id: z.string().regex(/^AUD-[0-9A-HJKMNP-TV-Z]{10}$/),
  status: z.enum(orderStatuses),
  payment: z.enum(paymentMethods),
  pickupCity: pickupCitySchema,
  createdAt: z.string(),
  settledAt: z.string().nullable(),
  lines: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
  subtotal: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  vat: z.number().nonnegative(),
  grandTotal: z.number().nonnegative(),
  savedToAccount: z.boolean(),
});

export type OrderSummary = z.infer<typeof orderSummarySchema> & { lines: OrderLine[] };

export const newOrderSchema = z.strictObject({
  requestKey: z.uuid(),
  payment: z.enum(paymentMethods),
  pickupCity: pickupCitySchema,
  customer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    phone: z.string().trim().min(1).max(60),
    address: z.string().trim().min(1).max(300),
    zip: z.string().trim().min(1).max(30),
    city: z.string().trim().min(1).max(120),
    country: z.string().trim().min(1).max(120),
  }),
  items: z.array(z.strictObject({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(20),
}).refine(
  (order) => (order.payment === "in_person") === (order.pickupCity !== ""),
  { message: "Choose a pickup city for pay in person, and only then." },
);

export type NewOrder = z.infer<typeof newOrderSchema>;
