export const paymentMethods = ["hosted", "element", "transfer", "zelle", "in_person"] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

export type PickupCity = "santo_domingo" | "santiago";

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  hosted: "Hosted card",
  element: "Own card form",
  transfer: "DR bank transfer",
  zelle: "Zelle",
  in_person: "Pay in person",
};

export const pickupCityLabels: Record<PickupCity, string> = {
  santo_domingo: "Santo Domingo",
  santiago: "Santiago",
};

export function createOrderId() {
  const token = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0");
  return `AUD-${token}`;
}

export function confirmationCopy(method: PaymentMethod) {
  switch (method) {
    case "hosted":
      return "Stripe test Checkout will open next if test keys are on the server. This is not a live AZUL or live Stripe merchant charge. The order stays pending until Stripe reports payment.";
    case "element":
      return "Pay with Stripe Payment Element on this page. Card numbers stay on Stripe. This is test mode only, not the live DR card rail.";
    case "transfer":
      return "Nothing is charged here. The order stays unpaid until a Banreservas or Popular credit matches this order ID.";
    case "zelle":
      return "Nothing is charged here. The order stays unpaid until a Zelle payment matches the amount and this order ID in the memo.";
    case "in_person":
      return "Nothing is charged here. Pay on the dedicated AZUL terminal in the Dominican Republic. iPhone and iPad cannot tap-to-accept.";
  }
}
