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
      await loadProfile(currentUser);
      setStatus('Cloud account connected.');
    } catch (error) {
      if (status) { status.dataset.state = 'error'; status.textContent = 'Connection Status · Attention Required'; status.title = 'Account error: ' + (error?.message || 'Unknown error'); }
      if (accountStatus) accountStatus.textContent = 'Check Supabase table setup and Row Level Security policies.';
      setProfileStatus('Could not load your cloud profile. Check the Supabase SQL setup.');
    }
  }

  async function createAccount() {
    const name = $('createName')?.value.trim();
    const email = $('createEmail')?.value.trim().toLowerCase();
    const password = $('createPassword')?.value || '';
    const confirmPassword = $('createConfirmPassword')?.value || '';
    const message = $('createAccountStatus');

    if (!name || !email || !password || !confirmPassword) {
      if (message) message.textContent = 'Please fill in every field.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (message) message.textContent = 'Please enter a valid email address.';
      return;
    }
    if (password.length < 8) {
      if (message) message.textContent = 'Password must be at least 8 characters.';
      return;
    }
    if (password !== confirmPassword) {
      if (message) message.textContent = 'Passwords do not match.';
      return;
    }

    setAuthButtonsBusy(true);
    if (message) message.textContent = 'Creating your secure account...';
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } }
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
        if (message) message.textContent = 'Account created successfully.';
        showAccountPage('profile');
      } else {
        if (message) message.textContent = 'Account created. Check your email to confirm it, then log in.';
        setStatus('Email confirmation is required before login.');
        showAccountPage('login');
      }
    } catch (error) {
      if (message) message.textContent = 'Sign-up failed: ' + (error?.message || 'Unknown error');
    } finally {
      setAuthButtonsBusy(false);
    }
  }

  async function login() {
    const email = $('loginEmail')?.value.trim().toLowerCase();
    const password = $('loginPassword')?.value || '';
    const message = $('loginStatus');
    if (!email || !password) {
      if (message) message.textContent = 'Enter your email and password.';
      return;
    }
    setAuthButtonsBusy(true);
    if (message) message.textContent = 'Signing in...';
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if ($('loginPassword')) $('loginPassword').value = '';
      currentUser = data.user;
      await refreshAuth();
      if (message) message.textContent = 'Login successful.';
      showAccountPage('profile');
    } catch (error) {
      if (message) message.textContent = 'Login failed: ' + (error?.message || 'Unknown error');
    } finally {
      setAuthButtonsBusy(false);
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

  function init() {
    if (!config?.url || !config?.anonKey || !supabaseLib?.createClient) {
      setStatus('Connection configuration error. Check the connection settings.');
      return;
    }
    client = supabaseLib.createClient(config.url, config.anonKey);

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
