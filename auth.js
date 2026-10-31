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
    if (/invalid login credentials|invalid email or password/.test(m)) return 'Email ba password thik noy. Abar check kore try koro.';
    if (/email not confirmed/.test(m)) return 'Email ekhono confirm kora hoyni. Inbox/spam folder theke confirmation link open koro.';
    if (/user already registered|already been registered|already exists/.test(m)) return 'Ei email diye account agei ache. Login koro, ba password reset use koro.';
    if (/password should be at least|weak password|password is too short/.test(m)) return 'Password aro strong koro; minimum 8 characters use koro.';
    if (/rate limit|too many requests|email rate limit/.test(m)) return 'Onnek chesta hoyeche. Kichukhon pore abar try koro.';
    if (/network|fetch failed|failed to fetch|load failed/.test(m)) return 'Network/Supabase connection hocche na. Internet check kore abar try koro.';
    if (/redirect|allow list|redirect_to|not allowed/.test(m)) return 'Supabase Auth URL settings-e ei website-er URL allow korte hobe.';
    if (/captcha/.test(m)) return 'Security verification complete kora jayni. Page refresh kore abar try koro.';
    if (/profiles|row-level security|permission denied|policy/.test(m)) return mode === 'signup'
      ? 'Account create request hoyeche, kintu profile database permission-e problem. Login diye account check koro; admin-ke Supabase RLS setup verify korte hobe.'
      : 'Login hoyeche kina session check koro; profile database permission-e problem ache. Supabase profiles RLS setup verify korte hobe.';
    return raw || 'Unknown error. Abar try koro.';
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

  function showSignedOut() {
    currentUser = null;
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
    const { data, error } = await client
      .from('profiles')
      .select('user_id,display_name,username,favorite_market,bio,notes,avatar_url,created_at,updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;

    const fallbackName = user.user_metadata?.display_name || user.email?.split('@')[0] || '';
    const profile = data || {
      user_id: user.id,
      display_name: fallbackName,
      username: '',
      favorite_market: 'Forex',
      bio: '',
      notes: '',
      avatar_url: ''
    };
    loadedProfile = profile;

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
        return;
      }
      // Authentication can succeed even if the profile table has a separate issue.
      if (details) details.textContent = 'Signed in: ' + (currentUser.email || 'account');
      if (statusTag) statusTag.textContent = 'Cloud account active';
      if ($('signOutBtn')) $('signOutBtn').hidden = false;
      setStatus('Cloud account connected.');
      await loadProfile(currentUser);
      setStatus('Cloud account connected.');
    } catch (error) {
      if (currentUser) {
        if (details) details.textContent = 'Signed in: ' + (currentUser.email || 'account') + ' · Profile unavailable';
        if (statusTag) statusTag.textContent = 'Signed in · Profile needs attention';
        if (status) { status.dataset.state = 'error'; status.textContent = 'Signed in · Profile Connection Needs Attention'; status.title = 'Profile error: ' + (error?.message || 'Unknown error'); }
        setProfileStatus('You are signed in, but your cloud profile could not be loaded. Check the Supabase profiles table and Row Level Security policies.');
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
      setMessage(message, 'Shob field fill up koro.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage(message, 'Valid email address dao.', 'error');
      return;
    }
    if (password.length < 8) {
      setMessage(message, 'Password minimum 8 characters hote hobe.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setMessage(message, 'Duita password match korche na.', 'error');
      return;
    }

    setAuthButtonsBusy(true);
    setMessage(message, 'Secure account create hocche…', '');
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
        setMessage(message, 'Account successfully create hoyeche. Tomar profile ready.', 'success');
        showAccountPage('profile');
      } else {
        setMessage(message, 'Account request successful. Email inbox/spam check kore confirmation link open koro.', 'success');
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
      setMessage(message, 'Email ebong password dao.', 'error');
      return;
    }
    setAuthButtonsBusy(true);
    setMessage(message, 'Securely sign in hocche…', '');
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if ($('loginPassword')) $('loginPassword').value = '';
      currentUser = data.user;
      await refreshAuth();
      setMessage(message, 'Login successful. Tomar cloud profile load hocche.', 'success');
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
      setMessage(message, 'Age Login email field-e valid email address dao, tarpor Forgot password chapো.', 'error');
      $('loginEmail')?.focus();
      return;
    }
    const button = $('forgotPasswordBtn');
    if (button) button.disabled = true;
    setMessage(message, 'Password reset link pathano hocche…', '');
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setMessage(message, 'Password reset link request kora hoyeche. Email inbox/spam check koro. Supabase email/redirect settings thik thakte hobe.', 'success');
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
      const { error } = await client.auth.signOut();
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
      setMessage($('createAccountStatus'), 'Account system load hoyni. Page refresh koro; issue thakle Supabase config/CDN check korte hobe.', 'error');
      setMessage($('loginStatus'), 'Login system load hoyni. Page refresh koro; issue thakle Supabase config/CDN check korte hobe.', 'error');
      return;
    }
    client = supabaseLib.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    // Keep the session across refreshes, but expire it after 7 full days without visiting the site.
    try {
      const now = Date.now();
      const lastVisit = Number(localStorage.getItem('nabilFxLastVisitAt') || 0);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (lastVisit && now - lastVisit >= sevenDays) {
        const { data } = await client.auth.getSession();
        if (data.session) await client.auth.signOut();
      }
      localStorage.setItem('nabilFxLastVisitAt', String(now));
    } catch (expiryError) {
      console.warn('Could not apply inactivity expiry:', expiryError);
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

    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      setTimeout(refreshAuth, 0);
    });
    refreshAuth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
