import { pageMetadata } from "../site-identity";

export const metadata = pageMetadata({
  path: "/checkout",
  title: "Checkout",
  description: "Place an Audiophile order with Stripe test cards, DR transfer, Zelle, or pay in person.",
});

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
