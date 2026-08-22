export const ZELLE_QR_IMAGE = "/images/payments/zelle-qr.png";

export function zellePageHref(orderId: string | null, amount: string) {
  const params = new URLSearchParams();
  if (orderId) {
    params.set("order", orderId);
  }
  if (amount) {
    params.set("amount", amount);
  }
  const query = params.toString();
  return query ? `/zelle?${query}` : "/zelle";
}

export function ZelleQr({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`zelle-qr${compact ? " is-compact" : ""}`}
      src={ZELLE_QR_IMAGE}
      alt={label}
      width={1290}
      height={1722}
    />
  );
}
