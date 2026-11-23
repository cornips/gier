# Contributing

Thanks for helping Gier circle better.

- Code, comments, commits, issues and docs are in **English**.
- Run `pnpm lint && pnpm typecheck && pnpm test` before opening a pull request.
- New shop? Add a store to `packages/core/src/stores/registry.ts` and, if JSON-LD is missing, a selector config in
  `packages/core/src/extract/selectors.ts`, plus an HTML fixture in `packages/core/test/fixtures/` with a test.
- Respect shops: keep request rates low, honour `robots.txt`, and never add code that bypasses logins or bot protection.
- Only add UI code that may be published under an open-source licence.

## Translations

English is the source language; Dutch is the first translation. Adding your language takes three steps:

1. Copy `apps/web/src/i18n/en.json` to `apps/web/src/i18n/<code>.json` (for example `de.json`) and translate the values.
   Keep the keys and the `{{placeholders}}` as they are.
2. Register it in `LANGUAGES` and `resources` in `apps/web/src/i18n/index.ts`.
3. Add the notification texts to `MESSAGES` and `LANGUAGES` in `apps/server/src/i18n.ts`.

The app picks your language automatically from the browser or system settings, and it can be changed in Settings.
A test checks that every translation has the same keys as English.
