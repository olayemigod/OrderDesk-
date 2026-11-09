(() => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PENDING_INVITATION_KEY = 'sellertray.pendingInvitationId';
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

  try {
    window.localStorage.setItem(PENDING_INVITATION_KEY, invitationId);
  } catch {
    // The query string still preserves the locator when browser storage is unavailable.
  }

  const appUrl = `sellertray://invite/${encodeURIComponent(invitationId)}`;
  openApp.href = appUrl;
  continueWeb.href = `/?invitation=${encodeURIComponent(invitationId)}`;

  // Do not auto-open an installed APK: an older app may not understand the
  // invitation locator and will show ordinary Home with no activation action.
  // Let the recipient deliberately choose App or the authenticated browser
  // review instead. Neither choice grants membership by itself.
})();
