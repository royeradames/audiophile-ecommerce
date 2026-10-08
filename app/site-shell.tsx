"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatPrice, getProduct } from "./catalog";
import { useCart } from "./cart-context";

const navigation = [
  { href: "/", label: "Home" },
  { href: "/headphones", label: "Headphones" },
  { href: "/speakers", label: "Speakers" },
  { href: "/earphones", label: "Earphones" },
  { href: "/account", label: "Account" },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const {
    items,
    itemCount,
    isCartOpen,
    closeCart,
    openCart,
    setQuantity,
    clearCart,
  } = useCart();

  useEffect(() => {
    if (isCartOpen) closeButtonRef.current?.focus();
  }, [isCartOpen]);

  const detailedItems = items.flatMap((line) => {
    const product = getProduct(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const total = detailedItems.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0,
  );

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
          <Link className="wordmark" href="/" aria-label="Audiophile home">
            audiophile
          </Link>
          <nav
            id="primary-navigation"
            className={`primary-nav ${menuOpen ? "is-open" : ""}`}
            aria-label="Primary navigation"
          >
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            className="cart-button"
            type="button"
            aria-haspopup="dialog"
            aria-label={`Open cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
            onClick={openCart}
          >
            Cart <span aria-hidden="true">{itemCount}</span>
          </button>
        </div>
      </header>

      <p className="demo-banner">
        <strong>Demo store:</strong> nothing is sold, charged or shipped. Card payments use Stripe test mode.
      </p>
      <main>{children}</main>

      <footer className="site-footer">
        <div className="footer-inner">
          <Link className="wordmark" href="/">
            audiophile
          </Link>
          <nav aria-label="Footer navigation">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
            <Link href="/payments">Payment stack</Link>
            <Link href="/zelle">Zelle</Link>
          </nav>
          <p>
            Audiophile is a demo store for considered home and personal audio,
            built as a portfolio challenge with fictional products. Nothing is
            sold, charged or shipped. Checkout runs end to end with Stripe test
            cards, and the store saves orders without your name, email, phone or
            address.
          </p>
          <p className="copyright">© 2026 Audiophile. Demo experience.</p>
        </div>
      </footer>

      {isCartOpen ? (
        <div className="dialog-layer" onMouseDown={closeCart}>
          <section
            className="cart-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="cart-heading">
              <div>
                <p className="eyebrow">Your selection</p>
                <h2 id="cart-title">Cart ({itemCount})</h2>
              </div>
              <button ref={closeButtonRef} className="text-button" onClick={closeCart}>
                Close
              </button>
            </div>

            {detailedItems.length ? (
              <>
                <ul className="cart-list">
                  {detailedItems.map(({ product, quantity }) => (
                    <li key={product.productId}>
                      <img src={product.cartImage} alt="" width="72" height="72" />
                      <div className="cart-item-copy">
                        <strong>{product.shortName}</strong>
                        <span>{formatPrice(product.price)}</span>
                      </div>
                      <div className="quantity-control" aria-label={`${product.name} quantity`}>
                        <button
                          type="button"
                          onClick={() => setQuantity(product.productId, quantity - 1)}
                          aria-label={`Decrease ${product.name} quantity`}
                        >
                          −
                        </button>
                        <span aria-live="polite">{quantity}</span>
                        <button
                          type="button"
                          onClick={() => setQuantity(product.productId, quantity + 1)}
                          aria-label={`Increase ${product.name} quantity`}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="cart-total">
                  <span>Total</span>
                  <strong>{formatPrice(total)}</strong>
                </div>
                <Link className="button button-primary button-block" href="/checkout" onClick={closeCart}>
                  Continue to checkout
                </Link>
                <button className="text-button remove-all" type="button" onClick={clearCart}>
                  Remove all items
                </button>
              </>
            ) : (
              <div className="empty-state">
                <h3>Your cart is ready for a first listen.</h3>
                <p>Browse the categories and add a product when you find the right fit.</p>
                <Link className="button button-primary" href="/headphones">
                  Browse headphones
                </Link>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
