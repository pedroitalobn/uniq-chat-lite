import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// IBM Plex Sans — fonte default do uniq.chat. Carregamos múltiplos pesos
// pra mapear hierarquia visual:
//   300 light    → metadados secundários (timestamps, captions, hints)
//   400 regular  → corpo de mensagens, texto comum
//   500 medium   → labels, nomes de contato, sub-headers
//   600 semibold → títulos de seção, headers de conversa, CTAs
//   700 bold     → títulos principais, valores destacados (badges, contadores)
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
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
