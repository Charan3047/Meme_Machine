const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');
const shareButton = document.querySelector('#share-button');
const toast = document.querySelector('#toast');

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
  navigation.classList.toggle('open', !isOpen);
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    navigation.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Open menu');
  });
});

let toastTimeout;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2400);
}

shareButton?.addEventListener('click', async () => {
  const shareData = { title: document.title, text: 'Play Meme Machine with me — a quick party game for friends!', url: window.location.href };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (error) { if (error.name !== 'AbortError') showToast('Could not open the share menu.'); }
    return;
  }
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Link copied. Send it to your group chat!');
  } catch {
    showToast('Copy this page link from your browser to share it.');
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();
