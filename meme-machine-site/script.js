const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');
const shareButton = document.querySelector('#share-button');
const themeButtons = document.querySelectorAll('[data-theme-toggle]');
const feedbackForm = document.querySelector('#website-feedback-form');
const toast = document.querySelector('#toast');

function applyTheme(theme, save = true) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  themeButtons.forEach((button) => {
    const dark = nextTheme === 'dark';
    button.innerHTML = `<span class="theme-toggle-icon" aria-hidden="true">${dark ? '☀' : '☾'}</span><span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
    button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    button.setAttribute('aria-pressed', String(dark));
  });
  if (save) {
    try { localStorage.setItem('mm-theme', nextTheme); } catch { /* Theme still works for this page view. */ }
  }
}

applyTheme(document.documentElement.dataset.theme || 'light', false);
themeButtons.forEach((button) => button.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}));

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

const yearLabel = document.querySelector('#year');
if (yearLabel) yearLabel.textContent = new Date().getFullYear();

feedbackForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(feedbackForm);
  const rating = formData.get('rating') || 'Not rated';
  const message = String(formData.get('message') || '').trim();
  if (!message && rating === 'Not rated') {
    document.querySelector('#feedback-status').textContent = 'Choose a rating or write a short note first.';
    return;
  }
  const body = `Website feedback\n\nRating: ${rating}/5\n\nMessage:\n${message || '(No written comment)'}\n\nSent from the Meme Machine promotional website.`;
  const issueUrl = new URL('https://github.com/Charan3047/Meme_Machine/issues/new');
  issueUrl.searchParams.set('title', 'Website feedback');
  issueUrl.searchParams.set('body', body);
  window.open(issueUrl.toString(), '_blank', 'noopener,noreferrer');
  document.querySelector('#feedback-status').textContent = 'A public GitHub draft opened in a new tab. Review it and submit there.';
});
