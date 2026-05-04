export default function HelpCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "Inter, system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
