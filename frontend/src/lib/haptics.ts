// haptics.ts — feedback tátil leve via navigator.vibrate. Em iOS Safari
// não funciona (Apple não expõe Web Vibration API), mas em Android/PWA
// instalada dá uma sensação significativamente mais nativa em taps de
// botões importantes, swipes, confirmações e erros.
//
// Pattern de uso:
//   import { haptic } from "@/lib/haptics";
//   onClick={() => { haptic.tap(); doStuff(); }}

export const haptic = {
  /** Tap leve — botões, links de nav, toggles */
  tap() {
    safeVibrate(8);
  },
  /** Mudança de seleção — picker, tabs */
  select() {
    safeVibrate(12);
  },
  /** Sucesso — submit ok, ação confirmada */
  success() {
    safeVibrate([10, 30, 18]);
  },
  /** Aviso — operação destrutiva, confirmação obrigatória */
  warning() {
    safeVibrate([18, 60, 18]);
  },
  /** Erro — falha de rede, validação */
  error() {
    safeVibrate([30, 80, 30, 80, 30]);
  },
};

function safeVibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // alguns browsers desktop / Safari ignoram silenciosamente — OK
  }
}
