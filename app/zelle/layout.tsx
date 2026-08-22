import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pay with Zelle",
  description:
    "Scan the Zelle QR, confirm the name, send the amount, and put the order ID in the memo.",
};

export default function ZelleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
