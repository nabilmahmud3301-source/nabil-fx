# Nabil Fx Backtesting — Cloud account setup

## What this build adds
- An Account page with email/password sign-up, sign-in and sign-out.
- A cloud profile sync path once Supabase is configured.
- A founder-only dashboard that reads basic profile summaries if the database role is founder.
- `supabase/schema.sql` with row-level security and a founder-email bootstrap trigger.

## Still required before cloud login works
1. Create a Supabase project under your own account.
2. In `supabase/schema.sql`, replace `founder@example.com` with the exact email address you will use for your Founder account, then run the SQL in Supabase SQL Editor.
3. Sign up with that same email in the website after the SQL is installed. If you already registered that email before installing the trigger, tell the setup guide to promote that existing profile using the Supabase SQL Editor as the project owner; do not allow users to change their own role.
4. In Supabase Project Settings / API, copy the Project URL and public anon/publishable key into `supabase-config.js`. Only the public client key belongs there. Never paste a service_role key, database password, or secret key into site files or chat.
5. In Supabase Auth URL settings, set the Site URL and allowed redirect URL to the exact GitHub Pages URL.
6. Upload all changed files to the repository root and commit. Wait for GitHub Pages deployment, then test account creation and sign-in.

## Security and current limits
- Founder access is based on a database role, not a name displayed in the UI.
- Row-level security is enabled for profiles. Test with two normal accounts to verify they cannot read each other's private profiles.
- The first implementation syncs profile text fields. User-uploaded profile photos remain browser-local; trade journal and backtest run history are not yet synced to cloud.
- This is a setup scaffold, not a claim that cloud authentication/database is live. The public site remains static until the owner completes Supabase setup and uploads these files.
- Never expose a Supabase `service_role` key in client code.
