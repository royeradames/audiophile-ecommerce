// Copy-button feedback that changes on every press (catalog CPY1, October 12, 2026).
// A second press must look and sound different from the first: the label counts
// presses ("Copied", "Copied ×2"), and the status text is cleared, then set to a new
// string, so screen readers announce it again. A rejected clipboard says so.
// No dependencies: React apps use useCopyFeedback, static pages call createCopyFeedback.

export type CopyState = "idle" | "copied" | "failed";

export type CopySnapshot = {
  state: CopyState;
  /** Presses in a row with the same result; resets after `countMs` with no press. */
  count: number;
  /** Label while not idle: "Copied", "Copied ×2", "Copy failed", "Copy failed ×2". */
  label: string;
  /** Text for a role="status" region that is always rendered. */
  message: string;
};

export const IDLE: CopySnapshot = { state: "idle", count: 0, label: "", message: "" };

/** Writes text to the clipboard; falls back to execCommand and keeps focus where it was. */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // NotAllowedError (no user activation, blurred document, iframe policy): try the fallback.
  }
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  let copied = false;
  try {
    area.select();
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  active?.focus?.({ preventScroll: true });
  return copied;
}

type Options = {
  onChange: (snapshot: CopySnapshot) => void;
  /** How long the label shows "Copied" after the last press. */
  labelMs?: number;
  /** How long presses keep counting, and a success message stays. */
  countMs?: number;
  /** Gap between clearing and setting the status text. */
  announceDelayMs?: number;
  write?: (text: string) => Promise<boolean>;
};

export function createCopyFeedback({ onChange, labelMs = 2000, countMs = 6000, announceDelayMs = 100, write = writeToClipboard }: Options) {
  let snapshot: CopySnapshot = IDLE;
  let disposed = false;
  const timers = { label: 0, count: 0, announce: 0 } as Record<"label" | "count" | "announce", ReturnType<typeof setTimeout> | 0>;
  const set = (next: Partial<CopySnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    onChange(snapshot);
  };
  const clear = (name: keyof typeof timers) => {
    if (timers[name]) clearTimeout(timers[name]);
    timers[name] = 0;
  };
  // Clear first, then set after a short gap: an identical string is not re-announced.
  const announce = (text: string) => {
    clear("announce");
    set({ message: "" });
    timers.announce = setTimeout(() => set({ message: text }), announceDelayMs);
  };

  /**
   * `what` names the thing copied, for example "the token". `hint` is the next step when the
   * copy fails; by default "Select the text and copy it by hand."
   */
  async function copy(value: string, what: string, hint = "Select the text and copy it by hand."): Promise<boolean> {
    const ok = await write(value);
    if (disposed) return ok;
    clear("label");
    clear("count");
    const count = (ok ? snapshot.state !== "failed" : snapshot.state === "failed") ? snapshot.count + 1 : 1;
    const again = count > 1 ? ` (${count})` : "";
    if (ok) {
      set({ state: "copied", count, label: count > 1 ? `Copied ×${count}` : "Copied" });
      announce(`Copied ${what}${again}.`);
      timers.label = setTimeout(() => set({ state: "idle", label: "" }), labelMs);
      timers.count = setTimeout(() => set({ count: 0, message: "" }), countMs);
    } else {
      // A failure stays on the button and in the status until the next press (catalog STS4).
      set({ state: "failed", count, label: count > 1 ? `Copy failed ×${count}` : "Copy failed" });
      announce(`Couldn't copy ${what}${again}. ${hint}`);
    }
    return ok;
  }

  function dispose() {
    disposed = true;
    clear("label");
    clear("count");
    clear("announce");
  }

  /** Undoes dispose(), for a React StrictMode remount of the same component. */
  function activate() {
    disposed = false;
  }

  /** Back to idle, for example when the value being copied is replaced. */
  function reset() {
    clear("label");
    clear("count");
    clear("announce");
    set(IDLE);
  }

  return { copy, dispose, activate, reset, snapshot: () => snapshot };
}
