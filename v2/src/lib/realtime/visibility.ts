import { useEffect, useRef, useState } from "react";

/**
 * Visibility-Aware Hook
 * 
 * Reduces unnecessary work when the browser tab is in the background.
 * - Throttles presence publishes
 * - Pauses non-critical renders
 * - Provides visibility state to consumers
 */

type VisibilityState = "visible" | "hidden";

const IS_DEV = process.env.NODE_ENV === "development";

let currentVisibility: VisibilityState = 
  typeof document !== "undefined" ? (document.visibilityState as VisibilityState) : "visible";

const visibilityListeners: Array<(state: VisibilityState) => void> = [];

// Global singleton listener
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    currentVisibility = document.visibilityState as VisibilityState;
    if (IS_DEV) console.log(`[VISIBILITY_STATE] Tab is now: ${currentVisibility}`);
    for (const fn of visibilityListeners) {
      fn(currentVisibility);
    }
  });
}

export function getVisibilityState(): VisibilityState {
  return currentVisibility;
}

export function isTabVisible(): boolean {
  return currentVisibility === "visible";
}

export function onVisibilityChange(fn: (state: VisibilityState) => void): () => void {
  visibilityListeners.push(fn);
  return () => {
    const idx = visibilityListeners.indexOf(fn);
    if (idx !== -1) visibilityListeners.splice(idx, 1);
  };
}

/**
 * Hook: useVisibilityThrottle
 * Returns true if the tab is currently visible.
 * Can be used to gate expensive renders or presence updates.
 */
export function useVisibilityThrottle(): boolean {
  const [isVisible, setIsVisible] = useState(isTabVisible());
  
  useEffect(() => {
    const cleanup = onVisibilityChange((state) => {
      setIsVisible(state === "visible");
    });
    return cleanup;
  }, []);

  return isVisible;
}
