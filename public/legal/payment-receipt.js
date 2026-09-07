document.getElementById('print-receipt')?.addEventListener('click', () => window.print());
document.getElementById('share-receipt')?.addEventListener('click', async () => {
  const button = document.getElementById('share-receipt');
  const text = `${document.querySelector('.receipt-header').innerText}\n\n${document.querySelector('.receipt-paper').innerText}`;
  button.disabled = true;
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, text });
    } else {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bulka-receipt.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      document.getElementById('share-status').textContent = {
        ru: 'Не удалось поделиться. Попробуйте ещё раз.',
        kk: 'Бөлісу мүмкін болмады. Қайталап көріңіз.',
        en: 'Could not share. Please try again.',
      }[document.documentElement.lang] || 'Could not share. Please try again.';
    }
  } finally {
    button.disabled = false;
  }
});
