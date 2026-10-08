import { pageMetadata } from "../site-identity";

export const metadata = pageMetadata({
  path: "/account",
  private: true,
  title: "Your account and orders",
  description: "Sign in with your Breakthrough account to see your Audiophile order history. Guest checkout always works.",
});

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
