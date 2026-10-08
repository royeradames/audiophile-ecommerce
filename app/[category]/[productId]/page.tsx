import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "../../add-to-cart";
import { formatPrice, getProduct } from "../../catalog";
import { ResponsiveImage } from "../../responsive-image";
import { BestGear, CategoryLinks } from "../../shared-sections";
import { pageMetadata } from "../../site-identity";

type ProductPageProps = {
  params: Promise<{ category: string; productId: string }>;
};

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { productId } = await params;
  const product = getProduct(productId);
  if (!product) return {};
  return pageMetadata({
    path: `/${product.category}/${product.productId}`,
    title: product.name,
    description: product.description,
    image: product.image.desktop,
  });
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { category, productId } = await params;
  const product = getProduct(productId);
  if (!product || product.category !== category) notFound();

  return (
    <>
      <article className="product-detail section">
        <div className="container">
          <Link className="back-link" href={`/${product.category}`}>
            <span aria-hidden="true">←</span> Back to {product.category}
          </Link>
          <div className="product-hero">
            <div className="product-image-wrap">
              <ResponsiveImage source={product.image} alt={`${product.name} product view`} loading="eager" />
            </div>
            <div className="product-summary">
              {product.isNew ? <p className="overline overline-accent">New product</p> : null}
              <h1>{product.name}</h1>
              <p>{product.description}</p>
              <p className="price">{formatPrice(product.price)}</p>
              <AddToCart productId={product.productId} productName={product.name} />
            </div>
          </div>

          <div className="product-information">
            <section aria-labelledby="features-title">
              <h2 id="features-title">Features</h2>
              {product.features.map((feature) => (
                <p key={feature}>{feature.replace(/^2From/, "From")}</p>
              ))}
            </section>
            <section aria-labelledby="box-title">
              <h2 id="box-title">In the box</h2>
              <ul className="included-list">
                {product.includedItems.map((item) => (
                  <li key={item.item}>
                    <strong>{item.quantity}×</strong> {item.item}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="gallery" aria-label={`${product.name} gallery`}>
            <ResponsiveImage source={product.gallery.first} alt={`${product.name} detail`} />
            <ResponsiveImage source={product.gallery.second} alt={`${product.name} in use`} />
            <ResponsiveImage source={product.gallery.third} alt={`${product.name} lifestyle view`} />
          </section>

          <section className="recommendations" aria-labelledby="recommendations-title">
            <h2 id="recommendations-title">You may also like</h2>
            <div className="recommendation-grid">
              {product.others.map((other) => (
                <article key={other.productId}>
                  <ResponsiveImage source={other.image} alt="" />
                  <h3>{other.name}</h3>
                  <Link className="button button-primary" href={`/${other.productId}`}>
                    See product
                  </Link>
                </article>
              ))}
            </div>
          </section>
        </div>
      </article>
      <CategoryLinks />
      <BestGear />
    </>
  );
}
