# Backup, restauro e deploys

Guia rápido. **Código** (GitHub/Vercel) e **dados** (Supabase) são independentes:
publicar/alterar código **não toca nas submissões dos utilizadores**.

> Nota: o repositório é público. Este ficheiro só tem comandos/procedimento — sem
> segredos nem dados. Os segredos (`.env.local`) e os backups (`backups/`) estão no
> `.gitignore` e **nunca** vão para o GitHub.

---

## Dados (Supabase) — backup e restauro

Os scripts correm **localmente** e usam o `service_role` do `.env.local`.

### Fazer um backup
```bash
npm run backup
```
Cria `backups/backup-<data>.json` com todas as tabelas (users, portfolios,
portfolio_stocks, member_pins, game_settings, portfolio_snapshots, ticker_sectors).
Cada backup é um retrato do momento; não substitui os anteriores. **Guarda os
ficheiros num local privado** (contêm os PINs e nomes).

### Restaurar (só em emergência)
```bash
npm run restore -- backups/backup-<data>.json --yes
```
Faz *upsert* na ordem das dependências: **repõe** linhas apagadas e **corrige** valores
sobrescritos (ex.: `initial_price`). **Não apaga** submissões que tenham entrado depois
desse backup (não é uma "viagem no tempo", é uma reparação).

### Quando fazer backup
- Agora / sempre que houver muitas submissões novas.
- Ao **fechar as submissões (30 jun)**.
- **Mesmo antes de clicar "Iniciar competição" (1 jul)** — esse passo reescreve o
  `initial_price` de todos os portefólios.

---

## Código (site) — deploy e rollback

### Publicar um update
```bash
git add -A
git commit -m "descrição"
git push
```
A Vercel faz o deploy automático a partir do `main`. As submissões no Supabase ficam
intactas.

### Reverter um update mau
- **Vercel** → projeto → *Deployments* → escolher o deploy anterior → **Promote to
  Production** (rollback instantâneo), ou
- `git revert <commit>` + `git push`.

---

## Segredos
Guardar num gestor de passwords (não se recuperam): `SUPABASE_SERVICE_ROLE_KEY`,
`ADMIN_PASSWORD`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALPHA_VANTAGE_API_KEY`, `NEXT_PUBLIC_LOGODEV_TOKEN`.
