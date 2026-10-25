
/* Supabase Auth + cloud profile starter for Nabil Fx Backtesting. */
(function () {
  const cfg = window.NABIL_SUPABASE_CONFIG || {};
  const statusEl = document.getElementById('cloudStatus');
  const details = document.getElementById('accountDetails');
  const signUp = document.getElementById('signUpBtn');
  const signIn = document.getElementById('signInBtn');
  const signOut = document.getElementById('signOutBtn');
  const founderPanel = document.getElementById('founderPanel');
  const founderStats = document.getElementById('founderStats');

  let client = null;
  let currentUser = null;

  const configured = !!(
    window.supabase &&
    cfg.url &&
    cfg.anonKey &&
    !cfg.url.includes('YOUR-PROJECT-REF') &&
    !cfg.anonKey.includes('YOUR_SUPABASE')
  );

  function message(s) {
    if (statusEl) statusEl.textContent = s;
  }

  function sayError(prefix, e) {
    message(prefix + ': ' + (e && e.message ? e.message : 'Unknown error'));
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  }

  if (!configured) {
    message('Cloud account is not configured. Check Supabase config and script loading.');
    [signUp, signIn, signOut].forEach(b => {
      if (b) b.disabled = true;
    });
    if (details) details.textContent = 'Cloud login not configured.';
    return;
  }

  client = window.supabase.createClient(cfg.url, cfg.anonKey);

  async function getRole() {
    const { data, error } = await client
      .from('profiles')
      .select('role')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) throw error;
    return (data && data.role) || 'user';
  }

  async function renderSession() {
    const { data, error } = await client.auth.getSession();
    if (error) {
      sayError('Session check failed', error);
      return;
    }

    currentUser = (data.session && data.session.user) || null;

    if (signUp) signUp.hidden = !!currentUser;
    if (signIn) signIn.hidden = !!currentUser;
    if (signOut) signOut.hidden = !currentUser;

    if (!currentUser) {
      if (details) details.textContent = 'Not signed in.';
      if (founderPanel) founderPanel.hidden = true;
      message('Supabase is connected. Create an account or sign in.');
      return;
    }

    if (details) details.textContent = 'Signed in as ' + currentUser.email;
    message('Signed in. Checking your database role…');

    try {
      const role = await getRole();

      if (role === 'founder') {
        if (founderPanel) founderPanel.hidden = false;

        const { data: profiles, error: profileError } = await client
          .from('profiles')
          .select('user_id,display_name,username,favorite_market,created_at')
          .order('created_at', { ascending: false })
          .limit(100);

        if (profileError) throw profileError;

        if (founderStats) {
          founderStats.innerHTML =
            '<b>Registered profiles (up to 100):</b>' +
            '<div class="tablewrap"><table><thead><tr>' +
            '<th>Name</th><th>Username</th><th>Market</th><th>Joined</th>' +
            '</tr></thead><tbody>' +
            (profiles || []).map(x =>
              '<tr><td>' + esc(x.display_name || '—') +
              '</td><td>' + esc(x.username || '—') +
              '</td><td>' + esc(x.favorite_market || '—') +
              '</td><td>' +
              esc(x.created_at ? new Date(x.created_at).toLocaleDateString() : '—') +
              '</td></tr>'
            ).join('') +
            '</tbody></table></div>';
        }

        message('Founder account verified by database role.');
      } else {
        if (founderPanel) founderPanel.hidden = true;
        message('Account connected. Your private cloud profile is available.');
      }
    } catch (e) {
      if (founderPanel) founderPanel.hidden = true;
      message('Signed in, but database setup/permissions need checking: ' + e.message);
    }
  }

  if (signUp) {
    signUp.addEventListener('click', async () => {
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;

      if (!email || password.length < 8) {
        return message('Enter a valid email and a password of at least 8 characters.');
      }

      message('Creating account…');

      try {
        const { error } = await client.auth.signUp({ email, password });
        if (error) return sayError('Sign-up failed', error);

        message('Account request sent. If email confirmation is enabled, check your inbox before signing in.');
      } catch (e) {
        sayError('Sign-up failed', e);
      }
    });
  }

  if (signIn) {
    signIn.addEventListener('click', async () => {
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;

      if (!email || !password) {
        return message('Enter your email and password.');
      }

      message('Signing in…');

      try {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) return sayError('Sign-in failed', error);
        await renderSession();
      } catch (e) {
        sayError('Sign-in failed', e);
      }
    });
  }

  if (signOut) {
    signOut.addEventListener('click', async () => {
      try {
        const { error } = await client.auth.signOut();
        if (error) return sayError('Sign-out failed', error);
        await renderSession();
      } catch (e) {
        sayError('Sign-out failed', e);
      }
    });
  }

  window.nabilCloudSaveProfile = async function (p) {
    if (!client || !currentUser) return;

    const row = {
      user_id: currentUser.id,
      display_name: p.visitorName || '',
      username: p.visitorHandle || '',
      favorite_market: p.visitorMarket || 'Forex',
      bio: p.visitorBio || '',
      notes: p.profileGoal || '',
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from('profiles')
      .upsert(row, { onConflict: 'user_id' });

    if (error) {
      message('Local profile saved; cloud sync failed: ' + error.message);
    } else {
      message('Profile saved locally and synced to your cloud account.');
    }
  };

  client.auth.onAuthStateChange(() => {
    renderSession();
  });

  renderSession();
})();
