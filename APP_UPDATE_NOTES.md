# Nabil Fx — Website Repository

This package contains the repository files supplied for the Nabil Fx website, with the requested app-shell updates.

## App changes
- Uses the supplied NABIL FX artwork as `app-icon.png` for the installed app and site brand.
- In installed/standalone mode, hides the Install Nabil Fx App and App Help controls.
- In installed/standalone mode, shows a hamburger menu at the upper-left; navigation options including Home appear when opened.
- Website browser mode keeps the normal navigation and install controls.

## Deploy
Upload the contents of `nabil-fx-main/` to the root of the `nabil-fx` GitHub repository, replacing matching files, then commit. Keep all existing folders/assets.

Note: this is based on the repository ZIP supplied in chat; it does not back up live Supabase database contents or external service data.


Latest update: Removed Gmail and Telegram cards from the homepage. Contact Us now opens a dedicated page with two separate premium cards (Gmail and Telegram). The hamburger menu is positioned in the global header at the top-right for all pages in the installed app.
