import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
