import productsJson from "./products.json";
import type { Product } from "./types";
import { formatUsd } from "./checkout-totals";

export const products = productsJson as Product[];

export const categories = ["headphones", "speakers", "earphones"] as const;

export function getProduct(productId: string) {
  return products.find((product) => product.productId === productId);
}

export function getCategoryProducts(category: string) {
  return products
    .filter((product) => product.category === category)
    .sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.price - a.price);
}

export function formatPrice(value: number) {
  return formatUsd(value);
}
