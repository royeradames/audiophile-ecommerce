import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { categories, getCategoryProducts } from "../catalog";
import { ResponsiveImage } from "../responsive-image";
import { BestGear, CategoryLinks } from "../shared-sections";
import { pageMetadata } from "../site-identity";

type CategoryPageProps = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { category } = await params;
  if (!categories.includes(category as (typeof categories)[number])) return {};
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return pageMetadata({
    path: `/${category}`,
    title: label,
    description: `${label} in the Audiophile demo store: compare each model, its features and what comes in the box. Nothing is sold or shipped.`,
  });
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { category } = await params;
  if (!categories.includes(category as (typeof categories)[number])) notFound();
  const categoryProducts = getCategoryProducts(category);

  return (
    <>
      <header className="page-title-band">
        <div className="container">
          <p className="overline">Shop the collection</p>
          <h1>{category}</h1>
        </div>
      </header>
      <section className="catalog section" aria-label={`${category} products`}>
        <div className="container product-list">
          {categoryProducts.map((product, index) => (
            <article className={`product-row ${index % 2 ? "product-row-reverse" : ""}`} key={product.id}>
              <div className="product-image-wrap">
                <ResponsiveImage source={product.categoryImage} alt={`${product.name} product view`} />
              </div>
              <div className="product-summary">
                {product.isNew ? <p className="overline overline-accent">New product</p> : null}
                <h2>{product.name}</h2>
                <p>{product.description}</p>
                <p className="price">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(product.price)}</p>
                <Link className="button button-primary" href={`/${product.category}/${product.productId}`}>
                  See product
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <CategoryLinks />
      <BestGear />
    </>
  );
}
