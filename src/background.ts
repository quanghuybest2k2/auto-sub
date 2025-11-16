/**
 * Background Service Worker for Speech Translator Chrome Extension
 * Handles background tasks and manages extension lifecycle
 */

import { MessageType, ExtensionMessage, StorageKey } from './types';

/**
 * Initialize the extension on installation
 */
chrome.runtime.onInstalled.addListener(
  (details: chrome.runtime.InstalledDetails) => {
    console.log(
      'Speech Translator extension installed/updated',
      details.reason,
    );

    // Set default values on first install
    if (details.reason === 'install') {
      chrome.storage.local.set({
        [StorageKey.INPUT_LANG]: 'en-US',
        [StorageKey.OUTPUT_LANG]: 'es',
        [StorageKey.IS_ACTIVE]: false,
      });
    }
  },
);

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  console.log('Extension icon clicked', tab.id);
});

/**
 * Listen for messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => {
    console.log('Background received message:', message.type, sender);

    // Handle different message types
    switch (message.type) {
      case MessageType.STATUS_UPDATE:
        // Forward status updates to popup if open
        chrome.runtime.sendMessage(message).catch(() => {
          // Popup may not be open, ignore error
        });
        sendResponse({ received: true });
        break;

      case MessageType.ERROR:
        // Log errors
        console.error('Error from content script:', message.error);
        sendResponse({ received: true });
        break;

      case MessageType.TRANSLATION_RESULT:
        // Handle translation request from content script
        handleTranslationRequest(message.data)
          .then((result) => sendResponse({ success: true, data: result }))
          .catch((error) =>
            sendResponse({ success: false, error: error.message }),
          );
        return true; // Keep channel open for async response

      default:
        console.log('Unhandled message type:', message.type);
        sendResponse({ received: true });
    }

    return false;
  },
);

/**
 * Handle translation request using Google Translate API
 */
async function handleTranslationRequest(data: {
  text: string;
  sourceLang: string;
  targetLang: string;
}): Promise<any> {
  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: data.sourceLang,
      tl: data.targetLang,
      dt: 't',
      q: data.text,
    });

    const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Translation error in background:', error);
    throw error;
  }
}

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension started');
});

console.log('Speech Translator background service worker initialized');
