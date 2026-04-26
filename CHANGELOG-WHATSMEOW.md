# whatsmeow fork — patches aplicados

Pasta `vendor-fork/whatsmeow/` é um clone do upstream
[tulir/whatsmeow](https://github.com/tulir/whatsmeow) pinado no commit
`ce4daa5e5a86` (mesma versão do go.mod original) com cherry-picks de PRs
abertos que resolvem bugs ou adicionam features que a Uniq precisa.

`backend/go.mod` aponta `replace go.mau.fi/whatsmeow => ../vendor-fork/whatsmeow`
pra usar o fork.

## PRs aplicados (Apr/26)

| PR | Título | Resolve |
|---|---|---|
| [#1107](https://github.com/tulir/whatsmeow/pull/1107) | msgsecret: fix poll vote encryption (PN→LID) | Polls quebravam no iOS recente (`decrypt-fail`). Direto no nosso `SendPollMessage`. |
| [#1091](https://github.com/tulir/whatsmeow/pull/1091) | sqlstore: range queries em vez de LIKE | ~30% mais rápido em login/boot pra contas com histórico. Uniq tinha lentidão em prod. |
| [#974](https://github.com/tulir/whatsmeow/pull/974) | GetManyPNsForLIDs (batch lookup) | 1 query em vez de N pra resolver mil destinatários. Crítico pras Campanhas. |
| [#1101](https://github.com/tulir/whatsmeow/pull/1101) | MassInsertBuilder pra MessageSecrets/Sessions/LIDs | Boot mais rápido em accounts com muito volume. |
| [#749](https://github.com/tulir/whatsmeow/pull/749) | BuildContact + CRUD | Sync 2-way de contatos WhatsApp ↔ CRM Uniq. |
| [#1106](https://github.com/tulir/whatsmeow/pull/1106) | Fix pin messages edit attribute | 2 linhas — habilita pin sem erro. |

## PRs avaliados mas NÃO aplicados (conflito ou complexidade)

| PR | Por que pulamos |
|---|---|
| [#1098](https://github.com/tulir/whatsmeow/pull/1098) | dynamic LID resolve: conflitou em `internals.go` + `msgsecret.go` (upstream evoluiu). Nosso `ensureLID` cobre o caso comum. Reavaliar quando merger upstream. |
| [#1104](https://github.com/tulir/whatsmeow/pull/1104) | message capping/timelock: conflito profundo. Solução alternativa: backoff inteligente na queue (commit do mesmo dia). |
| [#1100](https://github.com/tulir/whatsmeow/pull/1100) | manual receipt sync: conflito. Reavaliar. |
| [#900](https://github.com/tulir/whatsmeow/pull/900) | parallelize device encryption: conflito. Pode ser feito depois. |
| [#998](https://github.com/tulir/whatsmeow/pull/998) | membership request notifications: já mergeado upstream. |
| [#967](https://github.com/tulir/whatsmeow/pull/967) | business order details: conflito. Avaliar quando o roadmap WABA puxar. |

## Como manter

- **Atualizar versão do whatsmeow**: clonar upstream no commit novo, recriar
  branch `uniq-patches` e re-cherry-pick os 6 PRs (alguns podem ter mergeado).
- **Adicionar novo PR**: cherry-pick em `vendor-fork/whatsmeow/`, build, commit.
- **Remover fork**: voltar `replace` em `go.mod` pro `github.com/tulir/whatsmeow vXXX`.
