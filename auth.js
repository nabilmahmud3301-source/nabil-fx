
(function () {
  const config = window.NABIL_SUPABASE_CONFIG;
  const supabaseLib = window.supabase;

  const status = document.getElementById("cloudStatus");
  const details = document.getElementById("accountDetails");
  const signUpBtn = document.getElementById("signUpBtn");
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const founderPanel = document.getElementById("founderPanel");
  const founderStats = document.getElementById("founderStats");

  let client;
  let currentUser = null;

  function showStatus(text) {
    if (status) status.textContent = text;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  if (!config?.url || !config?.anonKey || !supabaseLib?.createClient) {
    showStatus("Connection setup error. Check Supabase configuration.");
    return;
  }

  client = supabaseLib.createClient(config.url, config.anonKey);

  async function refreshAccount() {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;

      currentUser = data.session?.user || null;

      if (signUpBtn) signUpBtn.hidden = !!currentUser;
      if (signInBtn) signInBtn.hidden = !!currentUser;
      if (signOutBtn) signOutBtn.hidden = !currentUser;

      if (!currentUser) {
        if (details) details.textContent = "Not signed in";
        if (founderPanel) founderPanel.hidden = true;
        showStatus("Connected. Please create an account or sign in.");
        return;
      }

      if (details) details.textContent = "Signed in: " + currentUser.email;

      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (profileError) throw profileError;

      if (profile?.role === "founder") {
        if (founderPanel) founderPanel.hidden = false;

        const { data: rows, error: rowsError } = await client
          .from("profiles")
          .select("user_id,display_name,username,favorite_market,created_at")
          .order("created_at", { ascending: false })
          .limit(100);

        if (rowsError) throw rowsError;

        if (founderStats) {
          founderStats.innerHTML =
            "<p>Registered profiles (up to 100)</p>" +
            "<table><thead><tr><th>Name</th><th>Username</th>" +
            "<th>Market</th><th>Joined</th></tr></thead><tbody>" +
            (rows || []).map(row =>
              "<tr><td>" + escapeHTML(row.display_name || "—") +
              "</td><td>" + escapeHTML(row.username || "—") +
              "</td><td>" + escapeHTML(row.favorite_market || "—") +
              "</td><td>" + escapeHTML(row.created_at
                ? new Date(row.created_at).toLocaleDateString()
                : "—") + "</td></tr>"
            ).join("") +
            "</tbody></table>";
        }

        showStatus("Founder access verified.");
      } else {
        if (founderPanel) founderPanel.hidden = true;
        showStatus("Account connected. Cloud profile is available.");
      }
    } catch (error) {
      if (founderPanel) founderPanel.hidden = true;
      showStatus("Account error: " + error.message);
    }
  }

  if (signUpBtn) {
    signUpBtn.addEventListener("click", async () => {
      const email = document.getElementById("authEmail")?.value.trim();
      const password = document.getElementById("authPassword")?.value;

      if (!email || !password || password.length < 8) {
        showStatus("Enter email and a password of at least 8 characters.");
        return;
      }

      showStatus("Creating account...");

      const { data, error } = await client.auth.signUp({
        email,
        password
      });

      if (error) {
        showStatus("Sign-up failed: " + error.message);
        return;
      }

      if (data.session) {
        await refreshAccount();
      } else {
        showStatus("Check your email to confirm your account.");
      }
    });
  }

  if (signInBtn) {
    signInBtn.addEventListener("click", async () => {
      const email = document.getElementById("authEmail")?.value.trim();
      const password = document.getElementById("authPassword")?.value;

      if (!email || !password) {
        showStatus("Enter your email and password.");
        return;
      }

      showStatus("Signing in...");

      const { error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        showStatus("Sign-in failed: " + error.message);
        return;
      }

      await refreshAccount();
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      const { error } = await client.auth.signOut();

      if (error) {
        showStatus("Sign-out failed: " + error.message);
        return;
      }

      await refreshAccount();
    });
  }

  window.nabilCloudSaveProfile = async function (profile) {
    if (!currentUser) {
      showStatus("Sign in before saving your cloud profile.");
      return;
    }

    const row = {
      user_id: currentUser.id,
      display_name: profile.visitorName || "",
      username: profile.visitorHandle || "",
      favorite_market: profile.visitorMarket || "Forex",
      bio: profile.visitorBio || "",
      notes: profile.profileGoal || "",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("profiles")
      .upsert(row, { onConflict: "user_id" });

    if (error) {
      showStatus("Profile save failed: " + error.message);
    } else {
      showStatus("Cloud profile saved.");
    }
  };

  client.auth.onAuthStateChange(() => {
    setTimeout(refreshAccount, 0);
  });

  refreshAccount();
})();
