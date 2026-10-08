import Link from "next/link";
import { formatPrice } from "./catalog";
import type { OrderSummary } from "./order-api";
import { orderStatusLabels } from "./order-record";
import { paymentMethodLabels, pickupCityLabels } from "./payment-methods";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** A server order as its customer sees it. No staff actions. */
export function OrderSummaryCard({ order, headingLevel = 3, linkToOrder = false }: {
  order: OrderSummary;
  headingLevel?: 2 | 3;
  linkToOrder?: boolean;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="order-card" aria-labelledby={`${order.id}-title`}>
      <header className="order-card-head">
        <div>
          <p className={`stack-status order-status is-${order.status}`}>{orderStatusLabels[order.status]}</p>
          <Heading id={`${order.id}-title`}>{order.id}</Heading>
          <p>Placed {dateFormat.format(new Date(order.createdAt))}</p>
          {order.settledAt ? <p>Settled {dateFormat.format(new Date(order.settledAt))}</p> : null}
        </div>
        {linkToOrder ? (
          <Link className="button button-outline" href={`/checkout/pay?order=${encodeURIComponent(order.id)}`}>
            View order {order.id}
          </Link>
        ) : null}
      </header>

      <dl className="order-meta">
        <div>
          <dt>Method</dt>
          <dd>{paymentMethodLabels[order.payment]}</dd>
        </div>
        <div>
          <dt>Total (USD)</dt>
          <dd>
            {formatPrice(order.grandTotal)}
            <span>Includes {formatPrice(order.shipping)} demo shipping and {formatPrice(order.vat)} demo ITBIS 18%</span>
          </dd>
        </div>
        {order.payment === "in_person" && order.pickupCity ? (
          <div>
            <dt>Pickup</dt>
            <dd>{pickupCityLabels[order.pickupCity]}</dd>
          </div>
        ) : null}
      </dl>

      <ul className="order-lines">
        {order.lines.map((line) => (
          <li key={line.productId}>
            {line.name}
            <span>×{line.quantity} · {formatPrice(line.unitPrice * line.quantity)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
