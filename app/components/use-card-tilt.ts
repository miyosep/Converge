"use client";

import { useEffect, useRef } from "react";

export function useCardTilt(active = true) {
  const cardFrame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = cardFrame.current;
    const card = frame?.firstElementChild as HTMLElement | null;
    if (!active || !frame || !card) return;
    const motion = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    let animation = 0;
    const reset = () => {
      cancelAnimationFrame(animation);
      animation = 0;
      card.removeAttribute("data-tilting");
      card.style.removeProperty("--plan-rotate-x");
      card.style.removeProperty("--plan-rotate-y");
      card.style.removeProperty("--plan-shadow-x");
    };
    const move = (event: PointerEvent) => {
      if (!motion.matches || event.pointerType !== "mouse") return;
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        const bounds = frame.getBoundingClientRect();
        const x = Math.max(
          -1,
          Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
        );
        const y = Math.max(
          -1,
          Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
        );
        card.style.setProperty("--plan-rotate-x", `${-y * 1.4}deg`);
        card.style.setProperty("--plan-rotate-y", `${x * 1.4}deg`);
        card.style.setProperty("--plan-shadow-x", `${-x * 6}px`);
        card.dataset.tilting = "true";
      });
    };
    frame.addEventListener("pointermove", move);
    frame.addEventListener("pointerleave", reset);
    frame.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    motion.addEventListener("change", reset);
    return () => {
      reset();
      frame.removeEventListener("pointermove", move);
      frame.removeEventListener("pointerleave", reset);
      frame.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      motion.removeEventListener("change", reset);
    };
  }, [active]);
  return cardFrame;
}
