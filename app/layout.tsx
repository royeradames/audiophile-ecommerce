import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { CartProvider } from "./cart-context";
import { OrderProvider } from "./order-context";
import { PayeeProvider } from "./payee-context";
import { SHARE_IMAGE, SITE_NAME, SITE_URL } from "./site-identity";
import { SiteShell } from "./site-shell";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const shareImage = SHARE_IMAGE;
  const title = "Audiophile — Sound worth slowing down for";
  const description =
    "A responsive portfolio storefront experiment for considered personal and home audio.";

  return {
    metadataBase: new URL(SITE_URL),
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
      siteName: SITE_NAME,
      title,
      description,
      type: "website",
      images: [{ url: shareImage, width: 1731, height: 909, alt: "Audiophile — Sound worth slowing down for" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [shareImage],
    },
  };
}

const website = { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_URL };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={manrope.variable}>
        <script
          type="application/ld+json"
          // App-owned data: one site name everywhere (og:site_name, logo, JSON-LD).
          dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, "\\u003c") }}
        />
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
