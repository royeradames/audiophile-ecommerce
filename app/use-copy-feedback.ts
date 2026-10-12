"use client";

// React binding for copy-feedback.ts (catalog CPY1). Render `label` while state is not
// "idle", and always render a role="status" region holding `message`.
import { useEffect, useState } from "react";
import { createCopyFeedback, IDLE, type CopySnapshot } from "./copy-feedback";

export function useCopyFeedback() {
  const [snapshot, setSnapshot] = useState<CopySnapshot>(IDLE);
  const [feedback] = useState(() => createCopyFeedback({ onChange: setSnapshot }));
  useEffect(() => {
    feedback.activate();
    return () => feedback.dispose();
  }, [feedback]);
  return { ...snapshot, copy: feedback.copy, reset: feedback.reset };
}
