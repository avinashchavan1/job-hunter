// Already signed in? Skip the public page and open the app. (/?home keeps you here.)
try {
  const s = JSON.parse(localStorage.getItem('jh-auth') || 'null')
  if (s?.refresh_token && !new URLSearchParams(location.search).has('home')) location.replace('/app/')
} catch {
  /* no saved sign-in */
}
