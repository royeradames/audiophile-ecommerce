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
  image?: string;
  /** The home page uses its title as is; other pages get "| Audiophile". */
  absoluteTitle?: boolean;
};

// Page metadata whose share card names this page: Next.js replaces the root
// openGraph object rather than merging it, so every field is repeated here.
export function pageMetadata({ path, title, description, image, absoluteTitle }: PageShare): Metadata {
  const url = new URL(path, SITE_URL).href;
  const shareTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  const shareImage = image ? new URL(image, SITE_URL).href : SHARE_IMAGE;
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
      images: [image ? { url: shareImage, alt: title } : { url: shareImage, width: 1731, height: 909, alt: shareTitle }],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [shareImage] },
  };
}
