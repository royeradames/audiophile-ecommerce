/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { categories } from "./catalog";

export function CategoryLinks() {
  return (
    <section className="category-links section" aria-labelledby="shop-categories-title">
      <h2 className="sr-only" id="shop-categories-title">
        Shop by category
      </h2>
      <div className="container category-grid">
        {categories.map((category) => (
          <Link className="category-card" href={`/${category}`} key={category}>
            <img
              src={`/images/shared/desktop/image-${category}.png`}
              alt=""
              width="240"
              height="210"
              loading="lazy"
            />
            <strong>{category}</strong>
            <span>Shop <span aria-hidden="true">›</span></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function BestGear() {
  return (
    <section className="best-gear section" aria-labelledby="best-gear-title">
      <div className="container best-gear-grid">
        <picture>
          <source media="(min-width: 1024px)" srcSet="/images/shared/desktop/image-best-gear.jpg" />
          <source media="(min-width: 600px)" srcSet="/images/shared/tablet/image-best-gear.jpg" />
          <img
            src="/images/shared/mobile/image-best-gear.jpg"
            alt="A listener enjoying over-ear headphones"
            loading="lazy"
          />
        </picture>
        <div className="best-gear-copy">
          <p className="eyebrow">Listen with intention</p>
          <h2 id="best-gear-title">
            Bringing you the <span>best</span> audio gear
          </h2>
          <p>
            Our New York showroom pairs a carefully edited range with people who
            love sound. Compare fit, materials, and listening character before
            choosing what belongs in your everyday setup.
          </p>
        </div>
      </div>
    </section>
  );
}
