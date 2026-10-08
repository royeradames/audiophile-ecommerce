import { pageMetadata } from "../site-identity";

export const metadata = pageMetadata({
  path: "/orders",
  title: "Pending orders",
  description:
    "Owner queue for unpaid Audiophile orders. Mark paid or collected by hand. Saved in this browser only.",
});

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
