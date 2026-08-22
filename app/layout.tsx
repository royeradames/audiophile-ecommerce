import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { CartProvider } from "./cart-context";
import { OrderProvider } from "./order-context";
import { PayeeProvider } from "./payee-context";
import { SiteShell } from "./site-shell";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Audiophile — Sound worth slowing down for";
  const description =
    "A responsive portfolio storefront experiment for considered personal and home audio.";

  return {
    metadataBase: new URL(origin),
    title: { default: title, template: "%s | Audiophile" },
    description,
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      shortcut: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "Audiophile — Sound worth slowing down for" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={manrope.variable}>
        <CartProvider>
          <PayeeProvider>
            <OrderProvider>
              <SiteShell>{children}</SiteShell>
            </OrderProvider>
          </PayeeProvider>
        </CartProvider>
      </body>
    </html>
  );
}
