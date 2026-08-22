import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payment stack",
  description:
    "Dev-test payee details for Banreservas, Banco Popular, and Zelle. Checkout reads these values from this browser.",
};

export default function PaymentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
