import { pageMetadata } from "../../site-identity";

export const metadata = pageMetadata({
  path: "/checkout/pay",
  title: "Pay for your order",
  description: "Finish paying an Audiophile demo order with a Stripe test card. Nothing is charged.",
});

export default function PayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
