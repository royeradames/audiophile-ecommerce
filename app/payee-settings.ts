export const PAYEE_STORAGE_KEY = "audiophile-payee-stack-v2";

export type BankAccount = {
  id: "banreservas" | "popular";
  bank: string;
  account: string;
  type: string;
};

export type PayeeSettings = {
  mode: "dev-test";
  beneficiary: string;
  taxId: string;
  banks: [BankAccount, BankAccount];
  zelle: {
    name: string;
    handle: string;
  };
};

export const defaultPayeeSettings: PayeeSettings = {
  mode: "dev-test",
  beneficiary: "Audiophile Dev Test",
  taxId: "000-00000-0",
  banks: [
    {
      id: "banreservas",
      bank: "Banreservas",
      account: "960-000000000-1",
      type: "Checking",
    },
    {
      id: "popular",
      bank: "Banco Popular",
      account: "730-000000000-1",
      type: "Checking",
    },
  ],
  zelle: {
    name: "Royer Adames",
    handle: "",
  },
};

function asText(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
}

function parseBank(value: unknown, fallback: BankAccount): BankAccount {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return {
    id: fallback.id,
    bank: fallback.bank,
    account: asText(record.account, fallback.account),
    type: asText(record.type, fallback.type),
  };
}

/**
 * Reads stored payee JSON. Missing fields and empty strings fall back to the
 * mock Banreservas, Banco Popular, and Zelle defaults used in dev test.
 */
export function parsePayeeSettings(raw: unknown): PayeeSettings {
  if (!raw || typeof raw !== "object") {
    return defaultPayeeSettings;
  }
  const record = raw as Record<string, unknown>;
  const banks = Array.isArray(record.banks) ? record.banks : [];
  const zelle =
    record.zelle && typeof record.zelle === "object"
      ? (record.zelle as Record<string, unknown>)
      : {};

  return {
    mode: "dev-test",
    beneficiary: asText(record.beneficiary, defaultPayeeSettings.beneficiary),
    taxId: asText(record.taxId, defaultPayeeSettings.taxId),
    banks: [
      parseBank(
        banks.find((bank) => (bank as { id?: string })?.id === "banreservas") ?? banks[0],
        defaultPayeeSettings.banks[0],
      ),
      parseBank(
        banks.find((bank) => (bank as { id?: string })?.id === "popular") ?? banks[1],
        defaultPayeeSettings.banks[1],
      ),
    ],
    zelle: {
      name: asText(zelle.name, defaultPayeeSettings.zelle.name),
      handle: typeof zelle.handle === "string" ? zelle.handle.trim() : defaultPayeeSettings.zelle.handle,
    },
  };
}

export function readStoredPayeeSettings() {
  try {
    const saved = window.localStorage.getItem(PAYEE_STORAGE_KEY);
    if (!saved) {
      return defaultPayeeSettings;
    }
    return parsePayeeSettings(JSON.parse(saved));
  } catch {
    window.localStorage.removeItem(PAYEE_STORAGE_KEY);
    return defaultPayeeSettings;
  }
}

export function writeStoredPayeeSettings(settings: PayeeSettings) {
  window.localStorage.setItem(PAYEE_STORAGE_KEY, JSON.stringify(parsePayeeSettings(settings)));
}
