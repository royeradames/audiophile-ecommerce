"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  defaultPayeeSettings,
  parsePayeeSettings,
  readStoredPayeeSettings,
  writeStoredPayeeSettings,
  type PayeeSettings,
} from "./payee-settings";

type PayeeContextValue = {
  settings: PayeeSettings;
  saveSettings: (next: PayeeSettings) => void;
  restoreMockSettings: () => void;
};

const PayeeContext = createContext<PayeeContextValue | null>(null);

export function PayeeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<PayeeSettings>(defaultPayeeSettings);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setSettings(readStoredPayeeSettings());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) {
      writeStoredPayeeSettings(settings);
    }
  }, [hydrated, settings]);

  const saveSettings = useCallback((next: PayeeSettings) => {
    const parsed = parsePayeeSettings(next);
    writeStoredPayeeSettings(parsed);
    setSettings(parsed);
  }, []);

  const restoreMockSettings = useCallback(() => {
    writeStoredPayeeSettings(defaultPayeeSettings);
    setSettings(defaultPayeeSettings);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      saveSettings,
      restoreMockSettings,
    }),
    [settings, saveSettings, restoreMockSettings],
  );

  return <PayeeContext.Provider value={value}>{children}</PayeeContext.Provider>;
}

export function usePayeeSettings() {
  const value = useContext(PayeeContext);
  if (!value) {
    throw new Error("usePayeeSettings must be used inside PayeeProvider");
  }
  return value;
}
