/**
 * Popup script for Speech Translator Chrome Extension
 * Handles UI interactions and communicates with content script
 */

import {
  MessageType,
  RecognitionConfig,
  ExtensionMessage,
  StorageKey,
  ExtensionState,
} from './types';

// DOM Elements
const inputLangSelect = document.getElementById(
  'inputLang',
) as HTMLSelectElement;
const outputLangSelect = document.getElementById(
  'outputLang',
) as HTMLSelectElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

/**
 * Initialize the popup with saved settings
 */
async function initializePopup(): Promise<void> {
  try {
    // Load saved language preferences from storage
    const state = await loadState();

    if (state.inputLang) {
      inputLangSelect.value = state.inputLang;
    }

    if (state.outputLang) {
      outputLangSelect.value = state.outputLang;
    }

    // Update UI based on active state
    if (state.isActive) {
      updateUIState(true);
      statusDiv.textContent = 'Recognition Active';
      statusDiv.classList.add('active');
    }
  } catch (error) {
    console.error('Failed to initialize popup:', error);
    updateStatus('Initialization error', false);
  }
}

/**
 * Load extension state from chrome.storage
 */
async function loadState(): Promise<ExtensionState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [StorageKey.INPUT_LANG, StorageKey.OUTPUT_LANG, StorageKey.IS_ACTIVE],
      (result) => {
        resolve({
          inputLang: result[StorageKey.INPUT_LANG] || 'en-US',
          outputLang: result[StorageKey.OUTPUT_LANG] || 'es',
          isActive: result[StorageKey.IS_ACTIVE] || false,
        });
      },
    );
  });
}

/**
 * Save extension state to chrome.storage
 */
async function saveState(state: Partial<ExtensionState>): Promise<void> {
  return new Promise((resolve) => {
    const storageData: Record<string, any> = {};

    if (state.inputLang !== undefined) {
      storageData[StorageKey.INPUT_LANG] = state.inputLang;
    }
    if (state.outputLang !== undefined) {
      storageData[StorageKey.OUTPUT_LANG] = state.outputLang;
    }
    if (state.isActive !== undefined) {
      storageData[StorageKey.IS_ACTIVE] = state.isActive;
    }

    chrome.storage.local.set(storageData, resolve);
  });
}

/**
 * Get the current active tab
 */
async function getCurrentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }
  return tab;
}

/**
 * Send message to content script
 */
async function sendMessageToContentScript(
  message: ExtensionMessage,
): Promise<void> {
  try {
    const tab = await getCurrentTab();

    if (!tab.id) {
      throw new Error('Invalid tab ID');
    }

    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    console.error('Failed to send message to content script:', error);
    throw error;
  }
}

/**
 * Handle start button click
 */
async function handleStart(): Promise<void> {
  try {
    const config: RecognitionConfig = {
      inputLang: inputLangSelect.value,
      outputLang: outputLangSelect.value,
    };

    // Save current configuration
    await saveState({
      inputLang: config.inputLang,
      outputLang: config.outputLang,
      isActive: true,
    });

    // Send start message to content script
    const message: ExtensionMessage = {
      type: MessageType.START_RECOGNITION,
      config,
    };

    await sendMessageToContentScript(message);

    // Update UI
    updateUIState(true);
    updateStatus('Recognition Started', true);
  } catch (error) {
    console.error('Failed to start recognition:', error);
    updateStatus('Failed to start - reload page', false);
    await saveState({ isActive: false });
  }
}

/**
 * Handle stop button click
 */
async function handleStop(): Promise<void> {
  try {
    // Send stop message to content script
    const message: ExtensionMessage = {
      type: MessageType.STOP_RECOGNITION,
    };

    await sendMessageToContentScript(message);

    // Save state
    await saveState({ isActive: false });

    // Update UI
    updateUIState(false);
    updateStatus('Recognition Stopped', false);
  } catch (error) {
    console.error('Failed to stop recognition:', error);
    updateStatus('Failed to stop', false);
  }
}

/**
 * Update UI state based on recognition status
 */
function updateUIState(isActive: boolean): void {
  if (isActive) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    inputLangSelect.disabled = true;
    outputLangSelect.disabled = true;
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    inputLangSelect.disabled = false;
    outputLangSelect.disabled = false;
  }
}

/**
 * Update status display
 */
function updateStatus(message: string, isActive: boolean): void {
  statusDiv.textContent = message;

  if (isActive) {
    statusDiv.classList.add('active');
  } else {
    statusDiv.classList.remove('active');
  }
}

/**
 * Handle language selection changes
 */
async function handleLanguageChange(): Promise<void> {
  // Save the new language selections
  await saveState({
    inputLang: inputLangSelect.value,
    outputLang: outputLangSelect.value,
  });
}

/**
 * Listen for messages from content script
 */
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === MessageType.STATUS_UPDATE) {
      updateStatus(
        message.data?.status || 'Unknown status',
        message.data?.isActive || false,
      );
    } else if (message.type === MessageType.ERROR) {
      updateStatus(`Error: ${message.error}`, false);
      updateUIState(false);
      saveState({ isActive: false });
    }

    sendResponse({ received: true });
    return true;
  },
);

// Event listeners
startBtn.addEventListener('click', handleStart);
stopBtn.addEventListener('click', handleStop);
inputLangSelect.addEventListener('change', handleLanguageChange);
outputLangSelect.addEventListener('change', handleLanguageChange);

// Initialize on load
document.addEventListener('DOMContentLoaded', initializePopup);
