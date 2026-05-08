import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

// Inter — fonte default do uniq.chat (Apr/26). Pesos cobrindo a hierarquia:
//   300 light    → metadados secundários (timestamps, captions, hints)
//   400 regular  → corpo de mensagens, texto comum
//   500 medium   → labels, nomes de contato, sub-headers
//   600 semibold → títulos de seção, headers de conversa, CTAs
//   700 bold     → títulos principais, valores destacados (badges, contadores)
// Inter Tight com pesos leves — design pede leveza nos títulos, buttons e menus.
const sans = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Uniq.chat — WhatsApp API Platform",
  description: "Gerencie instâncias WhatsApp com facilidade e escala.",
  // Hints pra o navegador tratar como app instalável (PWA-lite). Ícone
  // virá do /icon.png. Sem service worker offline ainda — só o "look".
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Uniq.chat",
    statusBarStyle: "black-translucent",
  },
  applicationName: "Uniq.chat",
  formatDetection: { telephone: false },
  // Ícones — apple-touch-icon vira splash no iOS quando instalado como PWA.
  // Sem assets dedicados de splash, o iOS usa esse ícone + theme_color do
  // manifest pra renderizar a tela inicial.
  icons: {
    icon: "/logo-dark.png",
    shortcut: "/logo-dark.png",
    apple: "/logo-dark.png",
  },
};

// Viewport separado pra suportar safe-area-inset (notch iOS, home indicator).
// viewport-fit=cover habilita as env(safe-area-inset-*) no CSS, que o
// MobileDock e bottom sheets já consomem.
export const viewport: Viewport = {
  themeColor: "#0a0a14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
