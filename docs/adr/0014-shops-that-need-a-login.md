# ADR-014: Shops that need a login

- Status: Accepted
- Date: 2026-11-22

## Context

Wholesalers such as Sligro and Makro only show prices to logged-in business customers.

## Decision

- The user logs in themselves inside a remote browser: Cloudflare Browser Run with Live View and a human-in-the-loop handoff over CDP.
- Gier never stores the password; it stores only the resulting session cookies, encrypted with AES-256-GCM using `GIER_SECRET`.
- Each store can have its own login page (`rules.loginUrl`, editable in the login window), for shops whose account pages live elsewhere than the home page.
- Live View shows no on-screen keyboard on phones. There, the login window offers a typing field: the text is sent through the user's own Gier server to the field that has focus in the remote browser. It passes through memory only and is never stored or logged. On a computer, typing directly in Live View stays the default.
- One remote browser per store at a time, closed as soon as the login is done or the window is closed, so abandoned attempts do not use up Browser Run limits (Workers Free allows only a few concurrent browsers and minutes per day).
- Prices excluding VAT are converted to including VAT for comparison.

## Consequences

Sessions expire; Gier asks to log in again when checks start failing.
