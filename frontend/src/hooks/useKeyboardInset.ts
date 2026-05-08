"use client";

// useKeyboardInset — hook que escuta visualViewport.height pra detectar
// abertura do teclado virtual no iOS/Android e atualiza a CSS variable
// --kb-h. Composer da inbox e qualquer footer fixo no mobile usa
// `padding-bottom: var(--kb-h)` (via .uniq-keyboard-aware-bottom) pra
// "subir" junto com o teclado.
//
// visualViewport API funciona em iOS Safari 13+ e Chrome Android — sem
// fallback necessário, browsers antigos só não fazem o ajuste.

import { useEffect } from "react";

export function useKeyboardInset() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // diff = quanto o teclado ocupou da viewport.
      const diff = window.innerHeight - vv.height - (vv.offsetTop || 0);
      const px = diff > 50 ? diff : 0; // ignora ajustes triviais
      document.documentElement.style.setProperty("--kb-h", `${px}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.setProperty("--kb-h", "0px");
    };
  }, []);
}
