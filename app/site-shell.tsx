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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const {
    items,
    itemCount,
    isCartOpen,
    closeCart,
    openCart,
    setQuantity,
    clearCart,
  } = useCart();

  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const cartPanelRef = useRef<HTMLElement>(null);
  const cartOpener = useRef<HTMLElement | null>(null);
  const cartWasOpen = useRef(false);
  useEffect(() => {
    if (isCartOpen) {
      cartWasOpen.current = true;
      // Remember what opened the cart (the Cart button or Add to cart).
      // Safari leaves focus on <body> after a click, so <body> means "the Cart button".
      const active = document.activeElement;
      cartOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      closeButtonRef.current?.focus();
      return;
    }
    // Closing the cart (Escape, Close or the backdrop) returns focus to what
    // opened it, unless a link inside the cart took the visitor elsewhere.
    // Only a real close restores focus; the first render leaves it alone.
    if (!cartWasOpen.current) return;
    cartWasOpen.current = false;
    const opener = cartOpener.current;
    cartOpener.current = null;
    if (!document.activeElement || document.activeElement === document.body) {
      (opener?.isConnected ? opener : cartButtonRef.current)?.focus();
    }
  }, [isCartOpen]);

  // Removing items can remove the focused button (Remove all, or − at 1).
  // Keep focus in the open cart by moving it to Close.
  useEffect(() => {
    if (!isCartOpen) return;
    if (!cartPanelRef.current?.contains(document.activeElement)) closeButtonRef.current?.focus();
  }, [isCartOpen, items]);

  // The cart is a modal dialog: Tab and Shift+Tab cycle inside it.
  useEffect(() => {
    if (!isCartOpen) return;
    const keepFocusInCart = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !cartPanelRef.current) return;
      const stops = Array.from(
        cartPanelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const inside = cartPanelRef.current.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInCart);
    return () => document.removeEventListener("keydown", keepFocusInCart);
  }, [isCartOpen]);

  // Escape closes the phone menu and puts focus back on its button. While the
  // cart dialog is open, Escape belongs to the cart alone.
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isCartOpen) return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen, isCartOpen]);

  // The phone menu hides above 900 px; close it then, so it does not reopen
  // by itself when the window narrows again.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 901px)");
    const closeWhenWide = () => {
      if (wide.matches) setMenuOpen(false);
    };
    wide.addEventListener("change", closeWhenWide);
    return () => wide.removeEventListener("change", closeWhenWide);
  }, []);

  const navigationLinks = navigation.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={pathname === item.href ? "page" : undefined}
      onClick={() => setMenuOpen(false)}
    >
      {item.label}
    </Link>
  ));

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
            ref={menuButtonRef}
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
          {/* Wide screens: the links sit between the wordmark and the cart. */}
          <nav id="site-navigation" className="primary-nav desktop-nav" aria-label="Primary navigation">
            {navigationLinks}
          </nav>
          <button
            ref={cartButtonRef}
            className="cart-button"
            type="button"
            aria-haspopup="dialog"
            aria-label={`Open cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
            onClick={openCart}
          >
            Cart <span aria-hidden="true">{itemCount}</span>
          </button>
          {/* Phones: the menu opens as a row under the bar, so it follows the cart
              in the DOM and Tab meets Menu, wordmark, Cart, then the links. */}
          <nav
            id="primary-navigation"
            className={`primary-nav menu-nav ${menuOpen ? "is-open" : ""}`}
            aria-label="Site menu"
          >
            {navigationLinks}
          </nav>
        </div>
      </header>

      <aside aria-label="Demo store notice">
        <p className="demo-banner">
          <strong>Demo store:</strong> nothing is sold, charged or shipped. Card payments use Stripe test mode.
        </p>
      </aside>
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
            ref={cartPanelRef}
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
                      <div className="quantity-control" role="group" aria-label={`${product.name} quantity`}>
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
                <Link
                  className="button button-primary button-block"
                  href="/checkout"
                  onClick={() => {
                    // Leaving for checkout: don't pull focus back to a button
                    // on the page that is about to go away.
                    cartOpener.current = null;
                    cartWasOpen.current = false;
                    closeCart();
                  }}
                >
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
