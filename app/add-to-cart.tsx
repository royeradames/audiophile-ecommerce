"use client";

import { useState } from "react";
import { useCart } from "./cart-context";

export function AddToCart({ productId, productName }: { productId: string; productName: string }) {
  const [quantity, setQuantity] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const { addItem, openCart } = useCart();

  function add() {
    addItem(productId, quantity);
    setAnnouncement(`${quantity} ${productName} added to the cart.`);
    openCart();
  }

  return (
    <div className="add-to-cart-wrap">
      <div className="quantity-control quantity-large" role="group" aria-label={`${productName} quantity`}>
        <button
          type="button"
          onClick={() => setQuantity((current) => Math.max(1, current - 1))}
          aria-label={`Decrease ${productName} quantity`}
        >
          −
        </button>
        <span>{quantity}</span>
        <button
          type="button"
          onClick={() => setQuantity((current) => Math.min(10, current + 1))}
          aria-label={`Increase ${productName} quantity`}
        >
          +
        </button>
      </div>
      <button className="button button-primary" type="button" onClick={add}>
        Add to cart
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
