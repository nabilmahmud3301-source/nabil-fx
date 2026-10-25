/* Supabase Auth + cloud profile starter for Nabil Fx Backtesting. */
(function(){
  const cfg=window.NABIL_SUPABASE_CONFIG||{};
  const statusEl=document.getElementById('cloudStatus');
  const details=document.getElementById('accountDetails');
  const signUp=document.getElementById('signUpBtn'), signIn=document.getElementById('signInBtn'), signOut=document.getElementById('signOutBtn');
  const founderPanel=document.getElementById('founderPanel'), founderStats=document.getElementById('founderStats');
  let client=null, currentUser=null;
  const configured=window.supabase && cfg.url && cfg.anonKey && !cfg.url.includes('YOUR-PROJECT-REF') && !cfg.anonKey.includes('YOUR_SUPABASE');
  function message(s){if(statusEl)statusEl.textContent=s;}
  function sayError(prefix,e){message(prefix+': '+(e&&e.message?e.message:'Unknown error'));}
  if(!configured){message('Cloud account is not configured yet. Create a Supabase project, then put its Project URL and public anon/publishable key in supabase-config.js. Local profile saving still works.');[signUp,signIn,signOut].forEach(b=>{if(b)b.disabled=true});if(details)details.textContent='Cloud login not configured.';return;}
  client=window.supabase.createClient(cfg.url,cfg.anonKey);
  async function getRole(){const {data,error}=await client.from('profiles').select('role').eq('user_id',currentUser.id).maybeSingle();if(error)throw error;return data&&data.role||'user';}
  async function renderSession(){const {data}=await client.auth.getSession();currentUser=data.session&&data.session.user||null;signUp.hidden=!!currentUser;signIn.hidden=!!currentUser;signOut.hidden=!currentUser;
    if(!currentUser){details.textContent='Not signed in.';founderPanel.hidden=true;message('Supabase is connected. Create an account or sign in.');return;}
    details.textContent='Signed in as '+currentUser.email;message('Signed in. Checking your database role…');
    try{const role=await getRole();if(role==='founder'){founderPanel.hidden=false;const {data:profiles,error}=await client.from('profiles').select('user_id,display_name,username,favorite_market,created_at').order('created_at',{ascending:false}).limit(100);if(error)throw error;founderStats.innerHTML='<b>Registered profiles (up to 100):</b><div class="tablewrap"><table><thead><tr><th>Name</th><th>Username</th><th>Market</th><th>Joined</th></tr></thead><tbody>'+(profiles||[]).map(x=>'<tr><td>'+esc(x.display_name||'—')+'</td><td>'+esc(x.username||'—')+'</td><td>'+esc(x.favorite_market||'—')+'</td><td>'+esc(x.created_at?new Date(x.created_at).toLocaleDateString():'—')+'</td></tr>').join('')+'</tbody></table></div>';message('Founder account verified by database policy.');}else{founderPanel.hidden=true;message('Account connected. Your private cloud profile is available.');}}catch(e){founderPanel.hidden=true;message('Signed in, but database setup/permissions need checking: '+e.message);}}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  signUp.addEventListener('click',async()=>{const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||password.length<8)return message('Enter a valid email and a password of at least 8 characters.');message('Creating account…');const {error}=await client.auth.signUp({email,password});if(error)return sayError('Sign-up failed',error);message('Account request sent. If email confirmation is enabled, check your inbox before signing in.');});
  signIn.addEventListener('click',async()=>{const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||!password)return message('Enter your email and password.');message('Signing in…');const {error}=await client.auth.signInWithPassword({email,password});if(error)return sayError('Sign-in failed',error);await renderSession();});
  signOut.addEventListener('click',async()=>{const {error}=await client.auth.signOut();if(error)return sayError('Sign-out failed',error);await renderSession();});
  window.nabilCloudSaveProfile=async function(p){if(!client||!currentUser)return;const row={user_id:currentUser.id,display_name:p.visitorName||'',username:p.visitorHandle||'',favorite_market:p.visitorMarket||'Forex',bio:p.visitorBio||'',notes:p.profileGoal||'',updated_at:new Date().toISOString()};const {error}=await client.from('profiles').upsert(row,{onConflict:'user_id'});if(error)message('Local profile saved; cloud sync failed: '+error.message);else message('Profile saved locally and synced to your cloud account.');};
  client.auth.onAuthStateChange(()=>{setTimeout(renderSession,0)});renderSession();
})();
