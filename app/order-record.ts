import type { PaymentMethod, PickupCity } from "./payment-methods";

export const ORDER_STORAGE_KEY = "audiophile-orders-v1";

export const orderStatuses = [
  "pending_hosted",
  "pending_transfer",
  "pending_in_person",
  "paid",
  "in_person_collected",
  "cancelled",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type OrderCustomer = {
  name: string;
  email: string;
  phone: string;
  address: string;
  zip: string;
  city: string;
  country: string;
};

export type OrderRecord = {
  id: string;
  createdAt: string;
  status: OrderStatus;
  payment: PaymentMethod;
  pickupCity: PickupCity | "";
  customer: OrderCustomer;
  lines: OrderLine[];
  subtotal: number;
  shipping: number;
  vat: number;
  grandTotal: number;
  settledAt: string | null;
};

export type OrderDraft = Omit<OrderRecord, "status" | "settledAt">;

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending_hosted: "Pending card",
  pending_transfer: "Pending transfer",
  pending_in_person: "Pending in person",
  paid: "Paid",
  in_person_collected: "Collected",
  cancelled: "Cancelled",
};

export function initialStatus(payment: PaymentMethod): OrderStatus {
  switch (payment) {
    case "hosted":
    case "element":
      return "pending_hosted";
    case "in_person":
      return "pending_in_person";
    case "transfer":
    case "zelle":
      return "pending_transfer";
  }
}

export function isPending(status: OrderStatus) {
  return (
    status === "pending_hosted" ||
    status === "pending_transfer" ||
    status === "pending_in_person"
  );
}

export function canMarkPaid(order: OrderRecord) {
  return order.status === "pending_hosted" || order.status === "pending_transfer";
}

export function canMarkCollected(order: OrderRecord) {
  return order.status === "pending_in_person";
}

export function canCancel(order: OrderRecord) {
  return isPending(order.status);
}

export function buildOrder(draft: OrderDraft): OrderRecord {
  return {
    ...draft,
    status: initialStatus(draft.payment),
    settledAt: null,
  };
}

export function markPaid(order: OrderRecord, settledAt: string): OrderRecord {
  if (!canMarkPaid(order)) {
    return order;
  }
  return { ...order, status: "paid", settledAt };
}

export function markCollected(order: OrderRecord, settledAt: string): OrderRecord {
  if (!canMarkCollected(order)) {
    return order;
  }
  return { ...order, status: "in_person_collected", settledAt };
}

export function cancelOrder(order: OrderRecord): OrderRecord {
  if (!canCancel(order)) {
    return order;
  }
  return { ...order, status: "cancelled" };
}

function asText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function asMoney(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseLine(value: unknown): OrderLine | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const productId = asText(record.productId);
  const name = asText(record.name);
  const quantity = record.quantity;
  const unitPrice = asMoney(record.unitPrice);
  if (
    !productId ||
    !name ||
    !Number.isInteger(quantity) ||
    typeof quantity !== "number" ||
    quantity < 1 ||
    unitPrice === null
  ) {
    return null;
  }
  return { productId, name, quantity, unitPrice };
}

function parseCustomer(value: unknown): OrderCustomer | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = asText(record.name);
  const email = asText(record.email);
  const phone = asText(record.phone);
  const address = asText(record.address);
  const zip = asText(record.zip);
  const city = asText(record.city);
  const country = asText(record.country);
  if (!name || !email || !phone || !address || !zip || !city || !country) {
    return null;
  }
  return { name, email, phone, address, zip, city, country };
}

const storedPaymentMethods = {
  hosted: true,
  element: true,
  transfer: true,
  zelle: true,
  in_person: true,
} satisfies Record<PaymentMethod, true>;

const storedPickupCities = {
  santo_domingo: true,
  santiago: true,
  "": true,
} satisfies Record<PickupCity | "", true>;

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && value in storedPaymentMethods;
}

function isPickupCity(value: unknown): value is PickupCity | "" {
  return typeof value === "string" && value in storedPickupCities;
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return orderStatuses.includes(value as OrderStatus);
}

/**
 * Reads stored order JSON. Invalid rows are dropped so a corrupt queue cannot
 * block mark-paid / mark-collected.
 */
export function parseOrder(value: unknown): OrderRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = asText(record.id);
  const createdAt = asText(record.createdAt);
  const customer = parseCustomer(record.customer);
  const lines = Array.isArray(record.lines)
    ? record.lines.map(parseLine).filter((line): line is OrderLine => line !== null)
    : [];
  const subtotal = asMoney(record.subtotal);
  const shipping = asMoney(record.shipping);
  const vat = asMoney(record.vat);
  const grandTotal = asMoney(record.grandTotal);
  if (
    !id ||
    !id.startsWith("AUD-") ||
    !createdAt ||
    !isOrderStatus(record.status) ||
    !isPaymentMethod(record.payment) ||
    !isPickupCity(record.pickupCity) ||
    !customer ||
    !lines.length ||
    subtotal === null ||
    shipping === null ||
    vat === null ||
    grandTotal === null
  ) {
    return null;
  }

  const settledAt = record.settledAt === null ? null : asText(record.settledAt);
  if (record.settledAt !== null && settledAt === null) {
    return null;
  }

  return {
    id,
    createdAt,
    status: record.status,
    payment: record.payment,
    pickupCity: record.pickupCity,
    customer,
    lines,
    subtotal,
    shipping,
    vat,
    grandTotal,
    settledAt,
  };
}

export function parseOrders(raw: unknown): OrderRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((value) => {
    const order = parseOrder(value);
    return order ? [order] : [];
  });
}

export function readStoredOrders() {
  try {
    const saved = window.localStorage.getItem(ORDER_STORAGE_KEY);
    if (!saved) {
      return [];
    }
    return parseOrders(JSON.parse(saved));
  } catch {
    window.localStorage.removeItem(ORDER_STORAGE_KEY);
    return [];
  }
}

export function writeStoredOrders(orders: OrderRecord[]) {
  window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(parseOrders(orders)));
}
