
/* Nabil Fx Backtesting - Supabase Auth */
(function () {
  const cfg = window.NABIL_SUPABASE_CONFIG || {};
  const $ = id => document.getElementById(id);

  const statusEl = $("cloudStatus");
  const details = $("accountDetails");
  const signUp = $("signUpBtn");
  const signIn = $("signInBtn");
  const signOut = $("signOutBtn");
  const founderPanel = $("founderPanel");
  const founderStats = $("founderStats");

  let client = null;
  let currentUser = null;

  function message(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function errorMessage(prefix, error) {
    message(prefix + ": " + (error?.message || "Unknown error"));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  if (!window.supabase || !cfg.url || !cfg.anonKey) {
    message("Supabase configuration missing. Check supabase-config.js.");
    return;
  }

  client = window.supabase.createClient(cfg.url, cfg.anonKey);

  async function renderSession() {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;

      currentUser = data.session?.user || null;

      if (signUp) signUp.hidden = !!currentUser;
      if (signIn) signIn.hidden = !!currentUser;
      if (signOut) signOut.hidden = !currentUser;

      if (!currentUser) {
        if (details) details.textContent = "Not signed in.";
        if (founderPanel) founderPanel.hidden = true;
        message("Supabase connected. Create an account or sign in.");
        return;
      }

      if (details) details.textContent = "Signed in as " + currentUser.email;

      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (profileError) throw profileError;

      if (profile?.role === "founder") {
        if (founderPanel) founderPanel.hidden = false;

        const { data: profiles, error: listError } = await client
          .from("profiles")
          .select("user_id,display_name,username,favorite_market,created_at")
          .order("created_at", { ascending: false })
          .limit(100);

        if (listError) throw listError;

        if (founderStats) {
          founderStats.innerHTML =
            "<b>Registered profiles (up to 100):</b>" +
            '<div class="tablewrap"><table><thead><tr>' +
            "<th>Name</th><th>Username</th><th>Market</th><th>Joined</th>" +
            "</tr></thead><tbody>" +
            (profiles || []).map(p =>
              "<tr><td>" + esc(p.display_name || "—") +
              "</td><td>" + esc(p.username || "—") +
              "</td><td>" + esc(p.favorite_market || "—") +
              "</td><td>" + esc(p.created_at
                ? new Date(p.created_at).toLocaleDateString()
                : "—") +
              "</td></tr>"
            ).join("") +
            "</tbody></table></div>";
        }

        message("Founder role detected in database.");
      } else {
        if (founderPanel) founderPanel.hidden = true;
        message("Account connected. Your private cloud profile is available.");
      }
    } catch (error) {
      if (founderPanel) founderPanel.hidden = true;
      message("Account/database issue: " + error.message);
    }
  }

  if (signUp) signUp.addEventListener("click", async () => {
    const email = $("authEmail")?.value.trim();
    const password = $("authPassword")?.value || "";

    if (!email || password.length < 8) {
      message("Enter your email and a password of at least 8 characters.");
      return;
    }

    message("Creating account...");

    const { error } = await client.auth.signUp({ email, password });

    if (error) {
      errorMessage("Sign-up failed", error);
      return;
    }

    message("Account request sent. Check your email to confirm your account.");
  });

  if (signIn) signIn.addEventListener("click", async () => {
    const email = $("authEmail")?.value.trim();
    const password = $("authPassword")?.value || "";

    if (!email || !password) {
      message("Enter your email and password.");
      return;
    }

    message("Signing in...");

    const { error } = await client.auth.signInWithPassword({
      email, password
    });

    if (error) {
      errorMessage("Sign-in failed", error);
      return;
    }

    await renderSession();
  });

  if (signOut) signOut.addEventListener("click", async () => {
    const { error } = await client.auth.signOut();

    if (error) {
      errorMessage("Sign-out failed", error);
      return;
    }

    await renderSession();
  });

  window.nabilCloudSaveProfile = async function (p) {
    if (!client || !currentUser) return;

    const row = {
      user_id: currentUser.id,
      display_name: p.visitorName || "",
      username: p.visitorHandle || "",
      favorite_market: p.visitorMarket || "Forex",
      bio: p.visitorBio || "",
      notes: p.profileGoal || "",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("profiles")
      .upsert(row, { onConflict: "user_id" });

    if (error) {
      message("Cloud profile save failed: " + error.message);
    } else {
      message("Profile synced to your cloud account.");
    }
  };

  client.auth.onAuthStateChange(() => {
    setTimeout(renderSession, 0);
  });

  renderSession();
})();
