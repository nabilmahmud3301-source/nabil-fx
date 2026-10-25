# Nabil Fx Backtesting — Hosting & Founder Control Plan

## Your requested outcome
- The same Nabil brand banner and original profile photo appear for every visitor.
- Every visitor can make their own account/profile.
- “Founder — Nabil Al Mahmud” stays fixed and cannot be edited by visitors.
- The founder has control of the site and access to the administrative settings.
- User profiles, journals, and backtest history are stored in a shared database, not just one browser.

## Current honest status
The included site is still a static prototype. It is **not live**, does **not** yet have sign-in, a shared cloud database, or a secure admin console. Browser `localStorage` is not a real account system. Do not treat it as one.

## Free-first architecture prepared
- Front end: static site hosting on a provider's free tier (GitHub Pages / Cloudflare Pages / Netlify; current terms and account eligibility may change).
- Authentication and database: Supabase free tier, subject to its current limits/terms.
- Database foundation: `supabase/schema.sql` defines profiles, backtest runs, trade journal entries, and app settings with row-level security policies.
- Founder role: trusted `app_metadata.role = founder`. This must be assigned securely by an administrator; never let a visitor grant themselves the founder role from the browser.

## Safe setup sequence
1. Create a Supabase project under an account you control.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Enable the desired sign-in method (email/password or magic link) and set authentication redirect URLs to the final hosted site.
4. Assign the founder role to your own account using a trusted server-side/admin method. Never expose the Supabase `service_role` key in the website files.
5. Create the public hosting project under an account you control and publish the site files.
6. Add only the Supabase project URL and public anon/publishable key to the client configuration. These are designed to be public; row-level security must still be enabled and tested.
7. Implement and test sign-in, sign-out, password recovery, account profile, cloud journal/history, founder-only site settings, and user-data export/deletion before inviting users.
8. Test with two ordinary accounts and one founder account: users must never see or edit each other's private records; ordinary users must never access founder settings.

## Founder control checklist
A secure owner console should include:
- Founder-only login and role verification on the server/database.
- Change public site notices and maintenance status.
- Manage safe site-wide settings and supported data-provider status.
- View aggregate usage/health, not private user journals by default.
- Suspend or remove accounts only with clear safeguards and an audit trail.
- Export and back up the database; document recovery steps.
- Keep the fixed founder attribution and shared brand assets controlled by the site owner.

## Important limitation
This package is preparation, not a completed cloud deployment. I cannot create provider accounts, accept their terms, or publish under your identity without your explicit account access/authorization. No live URL, cloud credentials, or working multi-user accounts are claimed here. Never send passwords, recovery codes, or service-role secrets in chat.
