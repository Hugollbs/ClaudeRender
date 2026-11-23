import { useEffect, useState, type RefObject } from "react";

// Largeur courante d'un élément, mise à jour quand la fenêtre est redimensionnée.
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
