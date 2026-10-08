import { pageMetadata } from "../../site-identity";

export const metadata = pageMetadata({
  path: "/checkout/stripe",
  title: "Stripe test return",
  description: "Stripe test Checkout return. Confirmation here is not a live merchant charge.",
});

export default function StripeReturnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
