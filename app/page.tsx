/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { BestGear, CategoryLinks } from "./shared-sections";

export default function HomePage() {
  return (
    <>
      <link rel="preload" as="image" href="/images/home/desktop/image-hero.jpg" media="(width > 900px)" fetchPriority="high" />
      <link rel="preload" as="image" href="/images/home/tablet/image-hero.jpg" media="(620px < width <= 900px)" fetchPriority="high" />
      <link rel="preload" as="image" href="/images/home/mobile/image-hero.jpg" media="(width <= 620px)" fetchPriority="high" />
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="overline">New product</p>
            <h1 id="hero-title">XX99 Mark II headphones</h1>
            <p className="hero-description">
              Hear your library with studio-grade depth, precision, and comfort
              designed for long listening sessions.
            </p>
            <Link className="button button-primary" href="/headphones/xx99-mark-two-headphones">
              See product
            </Link>
          </div>
        </div>
      </section>

      <CategoryLinks />

      <section className="featured section" aria-labelledby="featured-title">
        <h2 className="sr-only" id="featured-title">
          Featured products
        </h2>
        <div className="container featured-grid">
          <article className="feature-zx9">
            <img
              src="/images/home/desktop/image-speaker-zx9.png"
              alt="ZX9 speaker in black"
              width="756"
              height="918"
              loading="lazy"
            />
            <div>
              <p className="eyebrow eyebrow-light">Room-filling clarity</p>
              <h3>ZX9 speaker</h3>
              <p>
                A precise active speaker system with the scale to make familiar
                recordings feel new again.
              </p>
              <Link className="button button-dark" href="/speakers/zx9-speaker">
                See product
              </Link>
            </div>
          </article>
          <article className="feature-zx7">
            <div>
              <h3>ZX7 speaker</h3>
              <Link className="button button-outline" href="/speakers/zx7-speaker">
                See product
              </Link>
            </div>
          </article>
          <article className="feature-yx1">
            <picture>
              <source media="(min-width: 1024px)" srcSet="/images/home/desktop/image-earphones-yx1.jpg" />
              <source media="(min-width: 600px)" srcSet="/images/home/tablet/image-earphones-yx1.jpg" />
              <img src="/images/home/mobile/image-earphones-yx1.jpg" alt="YX1 wireless earphones in their charging case" loading="lazy" />
            </picture>
            <div>
              <h3>YX1 earphones</h3>
              <p>Small enough for every day. Tuned for the details you usually miss.</p>
              <Link className="button button-outline" href="/earphones/yx1-earphones">
                See product
              </Link>
            </div>
          </article>
        </div>
      </section>

      <BestGear />
    </>
  );
}
