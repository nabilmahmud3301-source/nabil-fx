/* Nabil Fx — Supabase authentication and per-user profile */
(() => {
  'use strict';

  const config = window.NABIL_SUPABASE_CONFIG;
  const supabaseLib = window.supabase;
  const $ = (id) => document.getElementById(id);
  const status = $('cloudStatus');
  const details = $('accountDetails');
  const accountStatus = $('accountStatus');
  const statusTag = $('accountStatusTag');

  let client = null;
  let currentUser = null;
  let loadedProfile = null;
  let saving = false;
  let sessionExpiredByInactivity = false;
  const LAST_AUTHENTICATED_VISIT_KEY = 'nabilFxLastAuthenticatedVisitAt';

  function setStatus(message) {
    // The Account Status panel shows a compact connection indicator, not repeated provider text.
    if (status) {
      const failed = /error|failed|configuration|could not|check .*setup/i.test(String(message));
      status.dataset.state = failed ? 'error' : 'connected';
      status.textContent = failed ? 'Connection Status · Attention Required' : 'Connection Status · Connected';
      status.title = String(message || 'Connection status');
    }
    if (accountStatus) accountStatus.textContent = message;
  }

  function setProfileStatus(message) {
    const el = $('profileStatus');
    if (el) el.textContent = message;
  }

  function setMessage(el, message, kind = '') {
    if (!el) return;
    el.textContent = message;
    if (kind) el.dataset.kind = kind;
    else delete el.dataset.kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', 'polite');
  }

  function friendlyAuthError(error, mode = 'login') {
    const raw = String(error?.message || error || '');
    const m = raw.toLowerCase();
    if (/invalid login credentials|invalid email or password/.test(m)) return 'The email address or password is incorrect. Please check your details and try again.';
    if (/email not confirmed/.test(m)) return 'Your email is not confirmed yet. Please open the confirmation link in your inbox or spam folder.';
    if (/user already registered|already been registered|already exists/.test(m)) return 'An account with this email address already exists. Please sign in or reset your password.';
    if (/password should be at least|weak password|password is too short/.test(m)) return 'Please choose a stronger password with at least 8 characters.';
    if (/rate limit|too many requests|email rate limit/.test(m)) return 'Too many attempts. Please try again in a little while.';
    if (/network|fetch failed|failed to fetch|load failed/.test(m)) return 'Unable to connect. Please check your internet connection and try again.';
    if (/redirect|allow list|redirect_to|not allowed/.test(m)) return 'This website URL must be added to the allowed redirect URLs in the authentication settings.';
    if (/captcha/.test(m)) return 'Security verification could not be completed. Please refresh the page and try again.';
    if (/profiles|row-level security|permission denied|policy/.test(m)) return mode === 'signup'
      ? 'Your account was created, but a profile database permission issue occurred. Please try signing in. The administrator should review the database security policies.'
      : 'A profile database permission issue occurred. Please ask the administrator to review the database security policies.';
    return raw || 'An unexpected error occurred. Please try again.';
  }

  function bindAuthEnhancements() {
    const eyeOpen = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.7" stroke="currentColor" stroke-width="1.7"/></svg>';
    const eyeClosed = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c6.2 0 9.5 6 9.5 6a15 15 0 0 1-3.1 3.7M6.2 6.3C3.8 8 2.5 12 2.5 12s3.3 6 9.5 6c1.4 0 2.6-.3 3.7-.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    document.querySelectorAll('[data-toggle-password]').forEach(button => {
      button.addEventListener('click', () => {
        const input = $(button.dataset.togglePassword);
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.innerHTML = reveal ? eyeClosed : eyeOpen;
        button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        button.title = reveal ? 'Hide password' : 'Show password';
        button.setAttribute('aria-pressed', String(reveal));
      });
    });
    const submitOnEnter = (id, action) => {
      const input = $(id);
      input?.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); action(); }
      });
    };
    ['createName','createEmail','createPassword','createConfirmPassword'].forEach(id => submitOnEnter(id, createAccount));
    ['loginEmail','loginPassword'].forEach(id => submitOnEnter(id, login));
    $('forgotPasswordBtn')?.addEventListener('click', resetPassword);
  }

  function showAccountPage(page) {
    if (typeof window.showNabilPage === 'function') window.showNabilPage('account');
    if (typeof window.showNabilAccountPage === 'function') window.showNabilAccountPage(page);
  }

  function setAuthButtonsBusy(busy) {
    ['createAccountBtn', 'loginBtn', 'saveProfile', 'logoutBtn'].forEach(id => {
      const button = $(id);
      if (button) button.disabled = !!busy;
    });
  }

  function updateAuthNavigation(signedIn) {
    window.NABIL_IS_AUTHENTICATED = !!signedIn;
    const toggle = $('accountMenuToggle');
    const dropdown = $('accountDropdown');
    if (toggle) {
      toggle.textContent = signedIn ? 'Profile' : 'Account ▾';
      toggle.setAttribute('aria-label', signedIn ? 'Open personal profile' : 'Open account menu');
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (dropdown) dropdown.classList.remove('open');
    document.querySelectorAll('[data-account-page="create"],[data-account-page="login"]').forEach(button => {
      button.hidden = !!signedIn;
    });
    const pageTitle = document.querySelector('#page-account > .view-heading');
    const pageLead = document.querySelector('#page-account > .view-lead');
    if (pageTitle) pageTitle.textContent = signedIn ? 'Personal Profile' : 'Account';
    if (pageLead) pageLead.textContent = signedIn
      ? 'Manage your identity, trading preferences, and personal workspace.'
      : 'Create an account, log in, or open your profile.';
  }

  const confirmationReturn = (() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    return hash.get('type') === 'signup' || query.has('code');
  })();
  let confirmationRedirectHandled = false;

  function showSignedOut() {
    currentUser = null;
    updateAuthNavigation(false);
    loadedProfile = null;
    if (details) details.textContent = 'Not signed in';
    if (statusTag) statusTag.textContent = 'Not signed in';
    if ($('accountProfileName')) $('accountProfileName').textContent = 'Your Profile';
    if ($('accountProfileEmail')) $('accountProfileEmail').textContent = 'Not signed in';
    if ($('profileDisplayName')) $('profileDisplayName').value = '';
    if ($('profileUsername')) $('profileUsername').value = '';
    if ($('profileMarket')) $('profileMarket').value = 'Forex';
    if ($('profileBio')) $('profileBio').value = '';
    if ($('accountProfilePhoto')) $('accountProfilePhoto').src = 'profile-photo.jpg';
    setProfileStatus('Sign in to view and edit your profile.');
    if ($('signOutBtn')) $('signOutBtn').hidden = true;
    setStatus('Connection ready. Create an account or log in.');
  }

  async function loadProfile(user) {
    // Select existing columns dynamically so older profiles schemas do not fail
    // just because a newer optional field has not been migrated yet.
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;

    const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || '';
    let profile = data;
    if (!profile) {
      // Older accounts may predate the auth.users profile trigger. Create their
      // own row with the minimal expected fields, then use a safe UI fallback.
      const seed = {
        user_id: user.id,
        display_name: fallbackName,
        username: '',
        favorite_market: 'Forex',
        bio: '',
        notes: '',
        avatar_url: ''
      };
      const { data: created, error: createError } = await client
        .from('profiles')
        .upsert(seed, { onConflict: 'user_id' })
        .select('*')
        .maybeSingle();
      if (createError) throw createError;
      profile = created || seed;
    }
    profile = {
      user_id: user.id,
      display_name: profile.display_name || fallbackName,
      username: profile.username || '',
      favorite_market: profile.favorite_market || 'Forex',
      bio: profile.bio || '',
      notes: profile.notes || '',
      avatar_url: profile.avatar_url || '',
      ...profile
    };
    loadedProfile = profile;
    updateAuthNavigation(true);

    if ($('accountProfileName')) $('accountProfileName').textContent = profile.display_name || fallbackName || 'Your Profile';
    if ($('accountProfileEmail')) $('accountProfileEmail').textContent = user.email || '';
    if ($('profileDisplayName')) $('profileDisplayName').value = profile.display_name || fallbackName;
    if ($('profileUsername')) $('profileUsername').value = profile.username || '';
    if ($('profileMarket')) $('profileMarket').value = profile.favorite_market || 'Forex';
    if ($('profileBio')) $('profileBio').value = profile.bio || '';
    if ($('profileGoal')) {
      $('profileGoal').value = profile.notes || '';
      try {
        if (profile.notes) localStorage.setItem('nabilFxProfileNotes', profile.notes);
      } catch (_) {}
    }
    if ($('accountProfilePhoto')) $('accountProfilePhoto').src = profile.avatar_url || 'profile-photo.jpg';
    if (details) details.textContent = 'Signed in: ' + (user.email || 'account');
    if (statusTag) statusTag.textContent = 'Cloud account active';
    if ($('signOutBtn')) $('signOutBtn').hidden = false;
    setProfileStatus('Cloud profile loaded. You can edit your details and save.');
  }

  async function refreshAuth() {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      currentUser = data.session?.user || null;
      if (!currentUser) {
        showSignedOut();
        if (sessionExpiredByInactivity) {
          sessionExpiredByInactivity = false;
          showAccountPage('login');
          setProfileStatus('You were automatically logged out after 7 days without visiting Nabil FX. Please log in again with the same email address and password you used to create your account.');
          setStatus('Your 7-day inactive session expired. Please sign in again.');
        }
        return;
      }

      // A user may have been deleted from Supabase Auth while this browser
      // still has an old persisted session. Verify the identity with Auth
      // before treating the cached session as signed in.
      const verified = await client.auth.getUser();
      if (verified.error || !verified.data?.user) {
        const authError = verified.error;
        const errorCode = String(authError?.code || '').toLowerCase();
        const errorMessage = String(authError?.message || '').toLowerCase();
        const invalidIdentity =
          ['user_not_found', 'session_not_found', 'bad_jwt', 'invalid_jwt'].includes(errorCode) ||
          /user.*not found|user.*does not exist|invalid.*jwt|session.*not found|jwt.*expired|invalid claim/.test(errorMessage) ||
          authError?.status === 401 || authError?.status === 403;

        if (invalidIdentity) {
          // Clear only this browser's stale session; do not affect other users.
          await client.auth.signOut({ scope: 'local' });
          showSignedOut();
          setProfileStatus('Your previous login session is no longer valid. Please create a new account or sign in with a valid account.');
          setStatus('Old session cleared. Please sign in again.');
          return;
        }
        if (authError) throw authError;
        throw new Error('Supabase could not verify the signed-in user.');
      }
      currentUser = verified.data.user;
      updateAuthNavigation(true);

      // Authentication can succeed even if the profile table has a separate issue.
      if (details) details.textContent = 'Signed in: ' + (currentUser.email || 'account');
      if (statusTag) statusTag.textContent = 'Cloud account active';
      if ($('signOutBtn')) $('signOutBtn').hidden = false;
      setStatus('Cloud account connected.');
      await loadProfile(currentUser);
      setStatus('Cloud account connected.');
      if (confirmationReturn && !confirmationRedirectHandled) {
        confirmationRedirectHandled = true;
        showAccountPage('profile');
        // Remove one-time confirmation tokens from the address bar after Supabase has exchanged them.
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}
        setProfileStatus('Email confirmed. You are now signed in and your personal profile is ready.');
      }
    } catch (error) {
      if (currentUser) {
        if (details) details.textContent = 'Signed in: ' + (currentUser.email || 'account') + ' · Profile unavailable';
        if (statusTag) statusTag.textContent = 'Signed in · Profile needs attention';
        if (status) { status.dataset.state = 'error'; status.textContent = 'Signed in · Profile Connection Needs Attention'; status.title = 'Profile error: ' + (error?.message || 'Unknown error'); }
        setProfileStatus('You are signed in, but your cloud profile could not be loaded. Supabase error: ' + (error?.message || error?.code || 'Unknown error') + (error?.code ? ' [code: ' + error.code + ']' : ''));
      } else {
        if (status) { status.dataset.state = 'error'; status.textContent = 'Connection Status · Attention Required'; status.title = 'Account error: ' + (error?.message || 'Unknown error'); }
        setProfileStatus('Could not check your cloud account. Check your connection and Supabase setup.');
      }
    }
  }

  async function createAccount() {
    const name = $('createName')?.value.trim();
    const email = $('createEmail')?.value.trim().toLowerCase();
    const password = $('createPassword')?.value || '';
    const confirmPassword = $('createConfirmPassword')?.value || '';
    const message = $('createAccountStatus');

    if (!name || !email || !password || !confirmPassword) {
      setMessage(message, 'Please complete all fields.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage(message, 'Please enter a valid email address.', 'error');
      return;
    }
    if (password.length < 8) {
      setMessage(message, 'Password must contain at least 8 characters.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setMessage(message, 'The passwords do not match.', 'error');
      return;
    }

    setAuthButtonsBusy(true);
    setMessage(message, 'Creating your account securely…', '');
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;

      if ($('createPassword')) $('createPassword').value = '';
      if ($('createConfirmPassword')) $('createConfirmPassword').value = '';
      if ($('loginEmail')) $('loginEmail').value = email;

      if (data.session && data.user) {
        currentUser = data.user;
        const { error: profileError } = await client.from('profiles').upsert({
          user_id: data.user.id,
          display_name: name,
          favorite_market: 'Forex',
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (profileError) throw profileError;
        await refreshAuth();
        setMessage(message, 'Your account has been created successfully. Your profile is ready.', 'success');
        showAccountPage('profile');
      } else {
        setMessage(message, 'Your account request was successful. Please check your inbox or spam folder and open the confirmation link.', 'success');
        setMessage($('loginStatus'), 'Your account has been created. Please confirm your email using the link we sent, then log in here.', 'success');
        setStatus('Email confirmation is required before login.');
        showAccountPage('login');
      }
    } catch (error) {
      setMessage(message, friendlyAuthError(error, 'signup'), 'error');
    } finally {
      setAuthButtonsBusy(false);
    }
  }

  async function login() {
    const email = $('loginEmail')?.value.trim().toLowerCase();
    const password = $('loginPassword')?.value || '';
    const message = $('loginStatus');
    if (!email || !password) {
      setMessage(message, 'Please enter your email address and password.', 'error');
      return;
    }
    setAuthButtonsBusy(true);
    setMessage(message, 'Signing you in securely…', '');
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if ($('loginPassword')) $('loginPassword').value = '';
      currentUser = data.user;
      try { localStorage.setItem(LAST_AUTHENTICATED_VISIT_KEY, String(Date.now())); } catch (_) {}
      await refreshAuth();
      setMessage(message, 'You have signed in successfully. Your cloud profile is loading.', 'success');
      showAccountPage('profile');
    } catch (error) {
      setMessage(message, friendlyAuthError(error, 'login'), 'error');
    } finally {
      setAuthButtonsBusy(false);
    }
  }

  async function resetPassword() {
    const email = $('loginEmail')?.value.trim().toLowerCase();
    const message = $('loginStatus');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage(message, 'Please enter a valid email address in the Email field, then select Forgot Password.', 'error');
      $('loginEmail')?.focus();
      return;
    }
    const button = $('forgotPasswordBtn');
    if (button) button.disabled = true;
    setMessage(message, 'Sending password reset link…', '');
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setMessage(message, 'Your password reset link has been requested. Please check your inbox or spam folder. The email and redirect settings must be configured correctly.', 'success');
    } catch (error) {
      setMessage(message, friendlyAuthError(error, 'reset'), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function uploadAvatar(user) {
    const input = $('avatarUpload');
    const file = input?.files?.[0];
    if (!file) return loadedProfile?.avatar_url || '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a PNG, JPG or WebP image.');
    }
    if (file.size > 2 * 1024 * 1024) throw new Error('Profile picture must be 2 MB or smaller.');

    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const path = `${user.id}/${Date.now()}-${safeName}`;
    const { error } = await client.storage.from('avatars').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;
    const { data } = client.storage.from('avatars').getPublicUrl(path);
    return data.publicUrl;
  }

  async function saveProfile() {
    if (!currentUser) {
      setProfileStatus('Please log in before saving your profile.');
      showAccountPage('login');
      return;
    }
    if (saving) return;
    saving = true;
    setAuthButtonsBusy(true);
    setProfileStatus('Saving your cloud profile...');
    try {
      const displayName = $('profileDisplayName')?.value.trim() || '';
      const username = $('profileUsername')?.value.trim().replace(/^@/, '') || '';
      const favoriteMarket = $('profileMarket')?.value || 'Forex';
      const bio = $('profileBio')?.value.trim() || '';
      const notes = $('profileGoal')?.value || '';
      if (!displayName) throw new Error('Display name is required.');
      const avatarUrl = await uploadAvatar(currentUser);
      const row = {
        user_id: currentUser.id,
        display_name: displayName,
        username,
        favorite_market: favoriteMarket,
        bio,
        notes,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString()
      };
      const { error } = await client.from('profiles').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      try { localStorage.setItem('nabilFxProfileNotes', notes); } catch (_) {}
      if ($('accountProfileName')) $('accountProfileName').textContent = displayName;
      if ($('accountProfilePhoto')) $('accountProfilePhoto').src = avatarUrl || 'profile-photo.jpg';
      if ($('avatarUpload')) $('avatarUpload').value = '';
      loadedProfile = row;
      setProfileStatus('Profile saved successfully to your cloud account.');
      setStatus('Cloud profile saved.');
    } catch (error) {
      setProfileStatus('Profile save failed: ' + (error?.message || 'Unknown error'));
    } finally {
      saving = false;
      setAuthButtonsBusy(false);
    }
  }

  async function logout() {
    setAuthButtonsBusy(true);
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      showSignedOut();
      setStatus('You have logged out.');
      showAccountPage('login');
    } catch (error) {
      setStatus('Logout failed: ' + (error?.message || 'Unknown error'));
    } finally {
      setAuthButtonsBusy(false);
    }
  }

  async function init() {
    if (!config?.url || !config?.anonKey || !supabaseLib?.createClient) {
      setStatus('Connection configuration error. Supabase client/config not loaded. Check network and public config.');
      setMessage($('createAccountStatus'), 'The account system could not be loaded. Please refresh the page. If the issue persists, check the Supabase configuration and CDN.', 'error');
      setMessage($('loginStatus'), 'The sign-in system could not be loaded. Please refresh the page. If the issue persists, check the Supabase configuration and CDN.', 'error');
      return;
    }
    client = supabaseLib.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    // Expire this browser's saved login after 7 complete days without an actual site visit.
    // The timer is refreshed only when a signed-in user opens the website or signs in.
    try {
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) {
        const lastVisit = Number(localStorage.getItem(LAST_AUTHENTICATED_VISIT_KEY) || 0);
        if (lastVisit && now - lastVisit >= sevenDays) {
          sessionExpiredByInactivity = true;
          await client.auth.signOut({ scope: 'local' });
        } else {
          localStorage.setItem(LAST_AUTHENTICATED_VISIT_KEY, String(now));
        }
      }
    } catch (expiryError) {
      console.warn('Could not apply 7-day inactivity expiry:', expiryError);
    }

    bindAuthEnhancements();
    $('createAccountBtn')?.addEventListener('click', createAccount);
    $('loginBtn')?.addEventListener('click', login);
    $('saveProfile')?.addEventListener('click', saveProfile);
    $('logoutBtn')?.addEventListener('click', logout);
    $('avatarUpload')?.addEventListener('change', () => {
      const file = $('avatarUpload').files?.[0];
      if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        if (file) setProfileStatus('Choose a PNG, JPG or WebP image no larger than 2 MB.');
        return;
      }
      const preview = URL.createObjectURL(file);
      if ($('accountProfilePhoto')) $('accountProfilePhoto').src = preview;
    });

    client.auth.onAuthStateChange((event, session) => {
      currentUser = session?.user || null;
      if (event === 'SIGNED_IN' && session?.user) {
        try { localStorage.setItem(LAST_AUTHENTICATED_VISIT_KEY, String(Date.now())); } catch (_) {}
      }
      setTimeout(refreshAuth, 0);
    });
    refreshAuth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
