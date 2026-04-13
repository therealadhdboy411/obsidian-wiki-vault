// ─── WhatsApp PTT — background.js (service worker) ───────────────────────────
//
// Forwards global keyboard commands to the WhatsApp Web content script.
// Global shortcuts are customisable at chrome://extensions/shortcuts.
// ─────────────────────────────────────────────────────────────────────────────

let _recording = false;

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'ptt-start' && !_recording) {
    _recording = true;
    await sendToWhatsApp({ type: 'PTT_START' });

  } else if (command === 'ptt-stop' && _recording) {
    _recording = false;
    await sendToWhatsApp({ type: 'PTT_STOP' });

  } else if (command === 'ptt-listen') {
    // Toggle read-aloud — content script handles stop-if-playing vs read-last
    await sendToWhatsApp({ type: 'PTT_LISTEN' });
  }
});

// Reset recording state when any WhatsApp tab closes
chrome.tabs.onRemoved.addListener(() => {
  _recording = false;
});

/**
 * Find the most-recently-active WhatsApp Web tab and send it a message.
 * Silently ignores if no tab is found or the content script isn't ready.
 */
async function sendToWhatsApp(msg) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) return;

    const target = tabs.find(t => t.active) || tabs[0];

    await chrome.tabs.sendMessage(target.id, msg).catch(() => {
      _recording = false;
    });
  } catch {
    _recording = false;
  }
}
