const statusLabel = document.getElementById("loginStatus");

const params = new URLSearchParams(window.location.search);
const inviteCode = (params.get('invite') ?? '').trim();

if (inviteCode) {
  const redirectUrl = new URL('index.html', window.location.href);
  redirectUrl.searchParams.set('invite', inviteCode);
  statusLabel.textContent = 'アプリへ転送しています…';
  window.location.replace(redirectUrl.toString());
} else {
  statusLabel.textContent = 'このページは不要になりました。アプリ本体をご利用ください。';
}
