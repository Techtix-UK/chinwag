# Contributing to Chinwag

Thanks for helping! Bug reports, docs fixes and pull requests are all welcome.

## Before you start

- For bugs, open an issue with your version (`chinwag version`), OS, what happened and what you expected. Remove phone numbers and message content from logs.
- For larger changes, open an issue first so we can agree on the approach.
- Chinwag is deliberately **not** a bulk-messaging tool. Features that help send unsolicited messages, evade WhatsApp detection or automate account creation will not be accepted.

## Development setup

```bash
npm ci
cp .env.example .env          # local values; see README
npm run db:migrate
npm run dev -w server & npm run dev -w web
```

## Pull requests

- Keep changes focused; include tests for behaviour changes (`server/src/test`, whatsapp-web.js is mocked).
- `npm run typecheck && npm test` must pass (CI runs both against MariaDB).
- Database changes need a Prisma migration (`npm run db:migrate -- --name <change>`).
- Update the docs in `docs/` when behaviour or configuration changes.
- Write commit messages that explain *why*.

By contributing you agree that your contributions are licensed under the AGPL-3.0.
