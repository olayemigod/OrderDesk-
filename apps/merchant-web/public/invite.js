(() => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const params = new URLSearchParams(window.location.search);
  const rawInvitationId = (params.get('invitation') || '').trim().toLowerCase();
  const invitationId = UUID_RE.test(rawInvitationId) ? rawInvitationId : '';

  const openApp = document.getElementById('open-app');
  const continueWeb = document.getElementById('continue-web');
  const invalidLink = document.getElementById('invalid-link');
  const inviteMessage = document.getElementById('invite-message');

  if (!(openApp instanceof HTMLAnchorElement) || !(continueWeb instanceof HTMLAnchorElement)) return;

  if (!invitationId) {
    openApp.hidden = true;
    invalidLink?.removeAttribute('hidden');
    if (inviteMessage) inviteMessage.textContent = 'SellerTray could not identify this Business invitation.';
    continueWeb.href = '/';
    continueWeb.textContent = 'Open SellerTray';
    return;
  }

  const appUrl = `sellertray://invite/${encodeURIComponent(invitationId)}`;
  openApp.href = appUrl;
  continueWeb.href = `/?invitation=${encodeURIComponent(invitationId)}`;

  // The email uses this HTTPS page so recipients without the app still have a safe browser
  // fallback. On mobile, immediately try the registered SellerTray scheme; the visible button
  // remains available when the browser blocks automatic scheme navigation.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') window.location.href = appUrl;
    }, 180);
  }
})();
