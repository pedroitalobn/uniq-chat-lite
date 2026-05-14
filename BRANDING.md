# Branding Guide — Uniq Lite

Tudo que diz respeito à identidade visual do app é configurável pelo painel
admin sem rebuild. Este guia descreve os presets, os assets recomendados e o
fluxo de personalização.

## Onde configurar

Logado como admin: **menu lateral → Branding** (ou acesse `/admin/branding`).

A página tem 4 seções:

1. **Identidade** — nome do app, família tipográfica
2. **Cores** — primária, secundária, destaque (com color picker)
3. **Estilo** — escolha entre 4 presets
4. **Assets** — logo light, logo dark, favicon, background do login

Toda mudança aplica preview ao vivo; persistir só com **Salvar**.

## Os 4 presets

### Modern
- **Quando usar:** SaaS moderno, startup, fintech, produto digital
- **Tipografia:** Inter
- **Visual:** radius generoso, sombras suaves, glassmorphism em surfaces
- **Vibe:** Linear / Vercel / Notion

### Classic
- **Quando usar:** Marca corporativa, jurídico, financeiro tradicional
- **Tipografia:** Playfair Display / Georgia (serif)
- **Visual:** radius pequeno, sombras discretas, sem efeito de vidro
- **Vibe:** banco / advocacia / editorial premium

### Standard
- **Quando usar:** Default neutro, quando você não quer escolher
- **Tipografia:** Geist
- **Visual:** radius médio, sombras shadcn padrão
- **Vibe:** dashboard genérico bem desenhado

### Minimal
- **Quando usar:** Marca austera, design brutalista, foco em densidade
- **Tipografia:** Inter
- **Visual:** sem sombras, sem radius, monocromático
- **Vibe:** Stripe Atlas / linear black-on-white

## Recomendações de assets

| Asset | Formato | Dimensão sugerida |
|---|---|---|
| Logo light (fundo branco) | SVG ou PNG transparente | 320×80 px |
| Logo dark (fundo escuro) | SVG ou PNG transparente | 320×80 px |
| Favicon | PNG quadrado | 256×256 px |
| Background do login | JPG / WebP | 1920×1080 px (otimizar ≤ 200 KB) |

O upload vai para o bucket MinIO/S3 configurado em `MINIO_*` no backend.

## Cores

As 3 cores são injetadas como CSS variables no `<html>`:

```css
--brand-primary: 99 102 241;   /* tuplas R G B */
--brand-secondary: 139 92 246;
--brand-accent: 236 72 153;
```

Use no seu código (Tailwind ou CSS) como:

```tsx
<div className="bg-brand-primary text-white" />
<div style={{ color: "rgb(var(--brand-primary))" }} />
<div className="bg-brand-primary/30" />  {/* com alpha */}
```

## Bootstrap inicial via `.env`

Se quiser que a primeira instalação já suba com marca pré-configurada, defina
no `.env` do backend antes do primeiro boot:

```env
BOOTSTRAP_ON_START=true
ADMIN_EMAIL=admin@suaempresa.com
ADMIN_PASSWORD=trocar-no-primeiro-login
```

O bootstrap apenas cria o usuário admin e as tabelas. A marca em si é
configurada pela UI no primeiro login (rápido, ~2 min).

## Reverter para defaults

Na página `/admin/branding`, clique em **Resetar para defaults**. As cores e
preset voltam ao padrão do produto; assets uploadados permanecem no bucket
mas não são mais referenciados.
