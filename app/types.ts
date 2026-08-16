export type ResponsiveImage = {
  mobile: string;
  tablet: string;
  desktop: string;
};

export type Product = {
  id: number;
  productId: string;
  name: string;
  shortName: string;
  image: ResponsiveImage;
  cartImage: string;
  category: "headphones" | "speakers" | "earphones";
  categoryImage: ResponsiveImage;
  isNew: boolean;
  price: number;
  description: string;
  features: string[];
  includedItems: Array<{ quantity: number; item: string }>;
  gallery: {
    first: ResponsiveImage;
    second: ResponsiveImage;
    third: ResponsiveImage;
  };
  others: Array<{
    productId: string;
    name: string;
    image: ResponsiveImage;
  }>;
};

export type CartLine = {
  productId: string;
  quantity: number;
};
