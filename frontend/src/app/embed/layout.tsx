export const metadata = { title: "Chat" };

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, padding: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}
