import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Place an Audiophile order with Stripe test cards, DR transfer, Zelle, or pay in person.",
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
