"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderSummaryCard } from "../order-summary-card";
import {
  fetchAccountOrders,
  fetchStoreFeatures,
  signOutOfAudiophile,
  startSignIn,
  type AccountOrders,
} from "../store-client";

type View = { state: "loading" } | { state: "coming_soon" } | AccountOrders;

const signInErrors: Record<string, string> = {
  expired: "That sign-in expired or was already used. Start again.",
  unavailable: "The Breakthrough account service did not answer. Try again in a moment.",
  linking: "This Breakthrough account could not be linked to Audiophile. Try again, or check out as a guest.",
};

export default function AccountPage() {
  const [view, setView] = useState<View>({ state: "loading" });
  const [busy, setBusy] = useState<"sign-in" | "sign-out" | "retry" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const features = await fetchStoreFeatures();
    if (features.accounts !== "enabled") return { state: "coming_soon" } as const;
    return fetchAccountOrders();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const reason = new URLSearchParams(window.location.search).get("error");
    void load().then((next) => {
      if (cancelled) return;
      setView(next);
      if (reason && signInErrors[reason]) setMessage(signInErrors[reason]);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function signIn() {
    if (busy) return;
    setBusy("sign-in");
    setMessage(null);
    try {
      window.location.assign(await startSignIn("/account"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in is temporarily unavailable.");
      setBusy(null);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy("sign-out");
    setMessage(null);
    try {
      await signOutOfAudiophile();
      setView({ state: "signed_out" });
      setMessage("Signed out of Audiophile on this browser. Your Breakthrough account is still signed in.");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not finish signing out. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    if (busy) return;
    setBusy("retry");
    setView(await load());
    setBusy(null);
  }

  return (
    <section className="stack-page section" aria-labelledby="account-title">
      <div className="container">
        <p className="overline overline-accent">Account</p>
        <div className="stack-intro">
          <div>
            <h1 id="account-title" ref={headingRef} tabIndex={-1}>Your orders</h1>
            <Intro view={view} />
          </div>
          {view.state === "signed_in" ? (
            <div className="stack-intro-actions">
              <button className="button button-outline" type="button" aria-busy={busy === "sign-out"} onClick={signOut}>
                {busy === "sign-out" ? "Signing out…" : "Sign out of Audiophile"}
              </button>
            </div>
          ) : null}
        </div>

        {message ? <p className="stack-hint" role="status">{message}</p> : null}

        {view.state === "loading" ? <p role="status">Checking your account…</p> : null}

        {view.state === "signed_out" ? (
          <div className="order-empty">
            <h2>Sign in to see your order history</h2>
            <p>
              Audiophile uses your Breakthrough account, the shared sign-in for Breakthrough
              Development apps. Orders you place while signed in are saved here and follow you to
              any browser.
            </p>
            <div className="order-card-actions">
              <button className="button button-primary" type="button" aria-busy={busy === "sign-in"} onClick={signIn}>
                {busy === "sign-in" ? "Opening sign-in…" : "Sign in with Breakthrough"}
              </button>
              <Link className="button button-outline" href="/headphones">Keep shopping as a guest</Link>
            </div>
          </div>
        ) : null}

        {view.state === "error" ? (
          <div className="order-empty" role="alert">
            <h2>Your orders could not be loaded</h2>
            <p>{view.error}</p>
            <button className="button button-primary" type="button" aria-busy={busy === "retry"} onClick={retry}>
              {busy === "retry" ? "Trying again…" : "Try again"}
            </button>
          </div>
        ) : null}

        {view.state === "signed_in" ? (
          view.orders.length === 0 ? (
            <div className="order-empty">
              <h2>No orders yet</h2>
              <p>Orders you place while signed in will appear here.</p>
              <Link className="button button-primary" href="/headphones">Browse headphones</Link>
            </div>
          ) : (
            <section className="order-group" aria-labelledby="history-heading">
              <h2 id="history-heading">Order history <span>{view.orders.length}</span></h2>
              <ul className="order-list">
                {view.orders.map((order) => (
                  <li key={order.id}>
                    <OrderSummaryCard order={order} linkToOrder />
                  </li>
                ))}
              </ul>
            </section>
          )
        ) : null}
      </div>
    </section>
  );
}

function Intro({ view }: { view: View }) {
  switch (view.state) {
    case "coming_soon":
      return (
        <p>
          Customer accounts are coming soon. Guest checkout works today, and each order
          confirmation gives you a link to check that order from any browser.
        </p>
      );
    case "signed_in":
      return <p>Signed in as {view.customer.name || view.customer.email} ({view.customer.email}). Newest orders first.</p>;
    case "signed_out":
      return <p>Guest checkout always works. Signing in keeps an order history across browsers.</p>;
    default:
      return null;
  }
}
