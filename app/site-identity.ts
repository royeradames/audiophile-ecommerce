import type { Metadata } from "next";

// One site name and one canonical address for the logo, og:site_name, og:url and
// WebSite JSON-LD. Previews and vercel.app hosts still point here on purpose:
// search engines and share cards should only ever name the production site.
export const SITE_NAME = "Audiophile";
export const SITE_URL = "https://audiophile.royeradames.com/";
export const SHARE_IMAGE = new URL("og.png", SITE_URL).href;

type PageShare = {
  path: string;
  title: string;
  description: string;
  image?: { url: string; width: number; height: number };
  /** Transactional or owner pages: kept out of search, with no canonical and no card of their own. */
  private?: boolean;
  /** The home page uses its title as is; other pages get "| Audiophile". */
  absoluteTitle?: boolean;
};

// Page metadata whose share card names this page: Next.js replaces the root
// openGraph object rather than merging it, so every field is repeated here.
export function pageMetadata({ path, title, description, image, absoluteTitle, private: hidden }: PageShare): Metadata {
  if (hidden) return { title, description, robots: { index: false, follow: false } };
  const url = new URL(path, SITE_URL).href;
  const shareTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  const shareImage = image ? new URL(image.url, SITE_URL).href : SHARE_IMAGE;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      url,
      title: shareTitle,
      description,
      images: [image ? { url: shareImage, width: image.width, height: image.height, alt: title } : { url: shareImage, width: 1731, height: 909, alt: shareTitle }],
    },
    // A near-square product photo reads better as a summary card than cropped to 2:1.
    twitter: { card: image ? "summary" : "summary_large_image", title: shareTitle, description, images: [shareImage] },
  };
}
