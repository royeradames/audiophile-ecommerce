type PaidEntry = {
  orderId: string;
  paidAt: string;
  source: string;
};

type Ledger = Map<string, PaidEntry>;

function getLedger(): Ledger {
  const globalLedger = globalThis as { __audiophilePaidLedger?: Ledger };
  if (!globalLedger.__audiophilePaidLedger) {
    globalLedger.__audiophilePaidLedger = new Map();
  }
  return globalLedger.__audiophilePaidLedger;
}

export function recordPaidOrder(orderId: string, source: string) {
  if (!orderId.startsWith("AUD-")) {
    return;
  }
  getLedger().set(orderId, {
    orderId,
    paidAt: new Date().toISOString(),
    source,
  });
}

export function listPaidOrders() {
  return [...getLedger().values()].sort((left, right) => right.paidAt.localeCompare(left.paidAt));
}
