import { pageMetadata } from "../site-identity";

export const metadata = pageMetadata({
  path: "/zelle",
  title: "Pay with Zelle",
  description:
    "Scan the Zelle QR, confirm the name, send the amount, and put the order ID in the memo.",
});

export default function ZelleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
