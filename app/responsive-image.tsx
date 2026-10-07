import type { ResponsiveImage as ImageSource } from "./types";

export function ResponsiveImage({
  source,
  alt,
  className,
  loading = "lazy",
}: {
  source: ImageSource;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  return (
    <picture>
      <source media="(min-width: 1024px)" srcSet={source.desktop} />
      <source media="(min-width: 600px)" srcSet={source.tablet} />
      <img
        className={className}
        src={source.mobile}
        alt={alt}
        loading={loading}
        fetchPriority={loading === "eager" ? "high" : "auto"}
        decoding="async"
      />
    </picture>
  );
}
