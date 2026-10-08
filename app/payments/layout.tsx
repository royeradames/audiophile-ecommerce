import { pageMetadata } from "../site-identity";

export const metadata = pageMetadata({
  path: "/payments",
  private: true,
  title: "Payment stack",
  description:
    "Dev-test payee details for Banreservas, Banco Popular, and Zelle. Checkout reads these values from this browser.",
});

export default function PaymentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
