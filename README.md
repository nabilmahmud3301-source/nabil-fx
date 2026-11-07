# Nabil Fx — Full Website Backup

This is the source backup for the **Nabil Fx** website. The GitHub repository has been renamed to `nabil-fx`.

## Files
- `index.html` — main website, visible brand, chart/backtest/journal/account interface
- `auth.js` — Supabase sign-up/sign-in/profile integration
- `supabase-config.js` — Supabase project URL and publishable key
- `supabase-setup.sql` and `supabase/schema.sql` — database schema setup (run only if the tables are not already created)
- `hero-banner.png` and `profile-photo.jpg` — website images; keep them in the same repository folder as `index.html`
- `BACKUP_AND_RESTORE_BANGLISH.txt` — Banglish restore instructions

## Current repository and website
- Repository: https://github.com/nabilmahmud3301-source/nabil-fx
- Expected GitHub Pages URL: https://nabilmahmud3301-source.github.io/nabil-fx/

## Restore / update the live website
1. Open the repository link above.
2. For each existing file (`index.html`, `auth.js`, `supabase-config.js`, `README.md`, and the SQL/docs if needed), open it and use **Edit** to replace its contents with the matching file from this backup; or use **Add file → Upload files** to upload the files from this folder to the repository root. If GitHub warns that a file already exists, replace it.
3. Do **not** delete or replace `hero-banner.png` and `profile-photo.jpg` unless you have their backup copies. Keep them beside `index.html`.
4. Click **Commit changes**. Check **Settings → Pages** to see the published URL and deployment status.
5. Open the site and press `Ctrl + F5`.

## Important
- `Nabil Fx` is the visible brand; `nabil-fx` is used in the URL because URLs cannot contain spaces.
- The Supabase project URL stays unchanged; it is the backend auth/database endpoint.
- This source backup does not include live Supabase users or database records.
- Never publish a Supabase service-role/secret key. Use only the publishable/anon key with correct Row Level Security (RLS).
