import { useEffect, useState, type RefObject } from "react";
import { zoomView, type View } from "./layout";

// Facteur de zoom par "cran" de molette : exp(deltaY * k). deltaY > 0 = zoom arrière.
const WHEEL_SENSITIVITY = 0.002;

// Gère la fenêtre de temps visible. Le zoom à la molette est branché à la main avec
// addEventListener({ passive: false }) : React enregistre ses propres listeners "wheel"
// en mode passif, donc preventDefault() y serait ignoré et la page défilerait en même temps.
export function useZoomPan(
  fullStart: number,
  fullEnd: number,
  plotWidth: number,
  labelWidth: number,
  containerRef: RefObject<HTMLElement | null>,
) {
  const [view, setView] = useState<View>({ t0: fullStart, t1: fullEnd });

  // Nouvelle session : on repart sur toute la durée.
  useEffect(() => {
    setView({ t0: fullStart, t1: fullEnd });
  }, [fullStart, fullEnd]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || plotWidth <= 0) return;
    const onWheel = (e: WheelEvent) => {
      const x = e.clientX - el.getBoundingClientRect().left - labelWidth;
      if (x < 0 || x > plotWidth) return; // sur les libellés : défilement normal
      e.preventDefault();
      const factor = Math.exp(e.deltaY * WHEEL_SENSITIVITY);
      setView((v) => zoomView(v, x / plotWidth, factor, fullStart, fullEnd));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, plotWidth, labelWidth, fullStart, fullEnd]);

  return { view, setView, resetView: () => setView({ t0: fullStart, t1: fullEnd }) };
}

// Suit un glisser sur toute la fenêtre. On écoute `window` plutôt que de capturer le pointeur :
// avec setPointerCapture, le "click" qui suit serait renvoyé à l'élément capturant
// et plus au span sur lequel l'utilisateur a cliqué.
export function trackDrag(onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent) => void) {
  const end = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    onEnd(e);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
