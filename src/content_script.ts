/**
 * Content Script for Speech Translator Chrome Extension
 * Handles speech recognition, translation, and overlay display
 */

import {
  MessageType,
  RecognitionConfig,
  ExtensionMessage,
  RecognitionStatus,
  TranslationResult,
  GoogleTranslateResponse,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
  StorageKey,
} from './types';

/**
 * Main controller class for speech recognition and translation
 */
class SpeechTranslatorController {
  private recognition: any | null = null;
  private config: RecognitionConfig | null = null;
  private overlay: HTMLDivElement | null = null;
  private isActive: boolean = false;
  private isDragging: boolean = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private clearTimer: number | null = null;
  private lastLineKey: string | null = null;

  constructor() {
    this.initializeMessageListener();
  }

  /**
   * Initialize message listener for popup communication
   */
  private initializeMessageListener(): void {
    chrome.runtime.onMessage.addListener(
      (
        message: ExtensionMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: any) => void,
      ) => {
        this.handleMessage(message)
          .then(() => sendResponse({ success: true }))
          .catch((error: Error) =>
            sendResponse({ success: false, error: error.message }),
          );

        return true; // Keep the message channel open for async response
      },
    );
  }

  /**
   * Handle incoming messages from popup
   */
  private async handleMessage(message: ExtensionMessage): Promise<void> {
    switch (message.type) {
      case MessageType.START_RECOGNITION:
        if (message.config) {
          await this.startRecognition(message.config);
        }
        break;

      case MessageType.STOP_RECOGNITION:
        await this.stopRecognition();
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  /**
   * Start speech recognition with the given configuration
   */
  private async startRecognition(config: RecognitionConfig): Promise<void> {
    try {
      // Check if Speech Recognition is supported
      if (
        !('webkitSpeechRecognition' in window) &&
        !('SpeechRecognition' in window)
      ) {
        throw new Error(
          'Speech Recognition API is not supported in this browser',
        );
      }

      this.config = config;
      this.isActive = true;

      // Create overlay
      this.createOverlay();

      // Initialize speech recognition
      const SpeechRecognitionAPI =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechRecognitionAPI();

      // Configure recognition for real-time streaming
      this.recognition.lang = config.inputLang;
      this.recognition.continuous = true; // Continuous recognition for real-time updates
      this.recognition.interimResults = true; // Enable interim results for progressive updates
      this.recognition.maxAlternatives = 1;

      // Set up event handlers
      this.recognition.onstart = () => this.handleRecognitionStart();
      this.recognition.onresult = (event: SpeechRecognitionEvent) =>
        this.handleRecognitionResult(event);
      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) =>
        this.handleRecognitionError(event);
      this.recognition.onend = () => this.handleRecognitionEnd();

      // Start recognition
      this.recognition.start();
      this.updateStatus(RecognitionStatus.LISTENING);
      this.updateOverlay('🎤 Ready', '#4caf50');
    } catch (error) {
      console.error('Failed to start recognition:', error);
      this.sendErrorMessage(
        error instanceof Error ? error.message : 'Unknown error',
      );
      this.cleanup();
    }
  }

  /**
   * Stop speech recognition
   */
  private async stopRecognition(): Promise<void> {
    this.isActive = false;

    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }

    this.cleanup();
    this.updateStatus(RecognitionStatus.IDLE);

    chrome.storage.local.set({ [StorageKey.IS_ACTIVE]: false });

    chrome.runtime
      .sendMessage({
        type: MessageType.STATUS_UPDATE,
        data: { isActive: false, status: 'Recognition Stopped' },
      })
      .catch(() => {});
  }

  /**
   * Handle recognition start event
   */
  private handleRecognitionStart(): void {
    console.log('Speech recognition started');
  }

  /**
   * Handle recognition result event (real-time streaming)
   */
  private async handleRecognitionResult(
    event: SpeechRecognitionEvent,
  ): Promise<void> {
    try {
      if (!this.config || !this.isActive) {
        return;
      }

      // Only use the newest result to reduce translation latency
      const lastIndex = event.results.length - 1;
      const result = event.results[lastIndex];
      const transcript = result[0].transcript;
      const isFinal = result.isFinal;

      console.log('Recognition result:', {
        transcript,
        isFinal,
        confidence: result[0].confidence,
      });

      // Skip very short interim chunks to avoid spam
      if (!isFinal && transcript.trim().length < 5) {
        return;
      }

      this.updateStatus(RecognitionStatus.TRANSLATING);

      const translation = await this.translateText(
        transcript,
        this.config.inputLang.split('-')[0], // Extract language code
        this.config.outputLang,
      );

      if (translation) {
        this.displayBothLanguages(
          translation.translatedText,
          transcript,
          isFinal,
        );
      } else if (!this.isActive) {
        return;
      }
    } catch (error) {
      console.error('Error handling recognition result:', error);
      if (
        error instanceof Error &&
        error.message.includes('Extension context invalidated')
      ) {
        console.warn('Extension context lost - stopping recognition');
        this.stopRecognition();
      }
    }
  }

  /**
   * Handle recognition error event
   */
  private handleRecognitionError(event: SpeechRecognitionErrorEvent): void {
    console.error('Speech recognition error:', event.error);

    let errorMessage = 'Recognition error';

    switch (event.error) {
      case 'no-speech':
        errorMessage = 'No speech detected';
        break;
      case 'audio-capture':
        errorMessage = 'Microphone not available';
        break;
      case 'not-allowed':
        errorMessage = 'Microphone permission denied';
        break;
      case 'network':
        errorMessage = 'Network error';
        break;
      default:
        errorMessage = `Error: ${event.error}`;
    }

    // Don't show errors on overlay, just log them
    // Auto-restart on recoverable errors
    if (
      this.isActive &&
      (event.error === 'no-speech' || event.error === 'aborted')
    ) {
      setTimeout(() => {
        if (this.recognition && this.isActive) {
          this.recognition.start();
        }
      }, 1000);
    } else {
      this.sendErrorMessage(errorMessage);
    }
  }

  /**
   * Handle recognition end event
   */
  private handleRecognitionEnd(): void {
    console.log('Speech recognition ended');

    if (!this.isActive) {
      this.cleanup();
    }
  }

  /**
   * Translate text using Google Translate API via background script
   */
  private async translateText(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<TranslationResult | null> {
    try {
      this.updateStatus(RecognitionStatus.TRANSLATING);

      // Send translation request to background script to avoid CORS
      const response = await chrome.runtime.sendMessage({
        type: MessageType.TRANSLATION_RESULT,
        data: {
          text,
          sourceLang,
          targetLang,
        },
      });

      if (!response) {
        // Extension context invalidated or no response
        console.warn(
          'No response from background script - extension may have been reloaded',
        );
        return null;
      }

      if (!response.success) {
        throw new Error(response.error || 'Translation failed');
      }

      const data: GoogleTranslateResponse = response.data;

      // Parse the response - handle multiple response formats
      let translatedText = '';

      // Log the raw response for debugging
      console.log('Translation API response:', data);

      if (data.sentences && Array.isArray(data.sentences)) {
        translatedText = data.sentences
          .map((sentence: any) => sentence.trans || '')
          .join('');
      } else if (Array.isArray(data) && data.length > 0) {
        // Alternative format: array at root level
        if (Array.isArray(data[0])) {
          translatedText = data[0]
            .map((item: any) => item[0] || '')
            .filter((text: string) => text)
            .join('');
        }
      }

      if (!translatedText) {
        console.warn('No translation extracted from response:', data);
        // Return null instead of throwing - don't show errors
        return null;
      }

      const result: TranslationResult = {
        originalText: text,
        translatedText,
        sourceLang,
        targetLang,
        timestamp: Date.now(),
      };

      console.log('Translation result:', result);
      return result;
    } catch (error) {
      // Handle extension context invalidation
      if (
        error instanceof Error &&
        error.message.includes('Extension context invalidated')
      ) {
        console.warn('Extension was reloaded - stopping recognition');
        this.stopRecognition();
        return null;
      }

      console.warn('Translation error:', error);
      // Don't show error on overlay, just log it
      return null;
    }
  }

  /**
   * Display both translated (output) and original (input) text
   */
  private displayBothLanguages(
    translatedText: string,
    originalText: string,
    isFinal: boolean,
  ): void {
    // Clear any existing timer
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }

    if (!this.overlay) {
      return;
    }

    // Create fixed container (header + list) if not already present
    if (!this.overlay.querySelector('.st-container')) {
      this.overlay.innerHTML = `
        <div class="st-container" style="display:flex;flex-direction:column;height:100%;">
          <div style="display:flex;align-items:center;justify-content:center;position:relative;padding-bottom:6px;">
            <div style="width:80px;height:4px;border-radius:999px;background:#666;"></div>
            <div style="position:absolute;right:4px;top:-4px;display:flex;gap:4px;align-items:center;">
              <button id="speech-translator-toggle" style="border:none;background:transparent;color:#fff;font-size:14px;cursor:pointer;padding:2px 4px;">⤢</button>
              <button id="speech-translator-close" style="border:none;background:transparent;color:#fff;font-size:16px;cursor:pointer;padding:2px 4px;">×</button>
            </div>
          </div>
          <div class="st-list" style="flex:1;overflow-y:auto;padding-right:6px;text-align:left;"></div>
        </div>
      `;

      const closeBtn = this.overlay.querySelector(
        '#speech-translator-close',
      ) as HTMLButtonElement | null;
      if (closeBtn) {
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          this.stopRecognition();
        };
      }

      const toggleBtn = this.overlay.querySelector(
        '#speech-translator-toggle',
      ) as HTMLButtonElement | null;
      if (toggleBtn) {
        toggleBtn.onclick = (e) => {
          e.stopPropagation();
          this.toggleOverlaySize(toggleBtn);
        };
      }
    }

    const list = this.overlay.querySelector(
      '.st-list',
    ) as HTMLDivElement | null;
    if (!list) return;

    // If there's no 'live' line, create a top block to display real-time results
    let liveBlock = this.overlay.querySelector(
      '.st-live',
    ) as HTMLDivElement | null;
    if (!liveBlock) {
      liveBlock = document.createElement('div');
      liveBlock.className = 'st-live';
      liveBlock.style.marginBottom = '8px';
      liveBlock.style.borderBottom = '1px solid rgba(255,255,255,0.15)';
      liveBlock.style.paddingBottom = '6px';
      list.insertBefore(liveBlock, list.firstChild);
    }

    // Update real-time content for the current sentence (multiline allowed)
    liveBlock.innerHTML = `
      <div style="font-size:15px;font-weight:600;line-height:1.3;color:#ffffff;white-space:normal;word-break:break-word;">
        ${this.escapeHtml(translatedText)}
      </div>
      <div style="font-size:12px;font-weight:400;line-height:1.2;color:#b0b0b0;white-space:normal;word-break:break-word;margin-top:2px;">
        ${this.escapeHtml(originalText)}
      </div>
    `;

    // When the result is final, move this block into the history list
    if (isFinal) {
      const currentKey = `${translatedText}|||${originalText}`;
      if (this.lastLineKey !== currentKey) {
        this.lastLineKey = currentKey;

        const historyBlock = liveBlock.cloneNode(true) as HTMLDivElement;
        historyBlock.classList.remove('st-live');
        historyBlock.style.borderBottom = 'none';
        historyBlock.style.paddingBottom = '0';
        historyBlock.style.marginBottom = '6px';

        // insert after liveBlock (or at the start of the list if liveBlock is removed later)
        if (liveBlock.nextSibling) {
          list.insertBefore(historyBlock, liveBlock.nextSibling);
        } else {
          list.appendChild(historyBlock);
        }
      }
    }
    this.updateStatus(RecognitionStatus.LISTENING);
    // For subtitle box with scrollbar we don't auto-clear,
    // allowing the user to scroll back to review previous content.
  }

  /**
   * Create the overlay element
   */
  private createOverlay(): void {
    if (this.overlay) {
      return;
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'speech-translator-overlay';

    // Apply styles for draggable full-width subtitle panel with scrollbar
    Object.assign(this.overlay.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '80px',
      margin: '0 auto',
      width: '100%',
      maxWidth: '900px',
      maxHeight: '320px',
      padding: '12px 16px',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      color: 'white',
      zIndex: '2147483647',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAlign: 'left',
      backdropFilter: 'blur(10px)',
      borderTop: '3px solid rgba(76, 175, 80, 0.6)',
      borderBottom: '3px solid rgba(76, 175, 80, 0.6)',
      borderRadius: '10px',
      transition: 'opacity 0.2s ease, transform 0.1s ease',
      pointerEvents: 'auto',
      cursor: 'move',
      userSelect: 'none',
      display: 'block',
      overflow: 'hidden',
    });

    // Add drag functionality
    this.overlay.addEventListener('mousedown', this.handleDragStart.bind(this));
    document.addEventListener('mousemove', this.handleDragMove.bind(this));
    document.addEventListener('mouseup', this.handleDragEnd.bind(this));

    document.body.appendChild(this.overlay);
  }

  /**
   * Toggle overlay between compact width and full-width
   */
  private toggleOverlaySize(button: HTMLButtonElement): void {
    if (!this.overlay) return;

    const isMaximized = this.overlay.dataset['stSize'] === 'max';

    if (isMaximized) {
      // Back to compact
      Object.assign(this.overlay.style, {
        left: '0',
        right: '0',
        margin: '0 auto',
        width: '100%',
        maxWidth: '900px',
      });
      this.overlay.dataset['stSize'] = 'min';
      button.textContent = '⤢'; // show max icon
    } else {
      // Full-width from left to right (height unchanged)
      Object.assign(this.overlay.style, {
        left: '0',
        right: '0',
        margin: '0',
        width: '100%',
        maxWidth: '100%',
      });
      this.overlay.dataset['stSize'] = 'max';
      button.textContent = '⤡'; // show min icon
    }
  }

  /**
   * Handle drag start
   */
  private handleDragStart(e: MouseEvent): void {
    if (!this.overlay) return;

    this.isDragging = true;
    const rect = this.overlay.getBoundingClientRect();
    this.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    // Remove transitions during drag
    this.overlay.style.transition = 'none';
  }

  /**
   * Handle drag move
   */
  private handleDragMove(e: MouseEvent): void {
    if (!this.isDragging || !this.overlay) return;

    e.preventDefault();

    // Calculate new position
    let newLeft = e.clientX - this.dragOffset.x;
    let newTop = e.clientY - this.dragOffset.y;

    // Constrain to viewport
    const maxLeft = window.innerWidth - this.overlay.offsetWidth;
    const maxTop = window.innerHeight - this.overlay.offsetHeight;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    // Apply position
    this.overlay.style.left = `${newLeft}px`;
    this.overlay.style.top = `${newTop}px`;
    this.overlay.style.bottom = 'auto';
    this.overlay.style.right = 'auto';
  }

  /**
   * Handle drag end
   */
  private handleDragEnd(): void {
    if (!this.overlay) return;

    this.isDragging = false;
    this.overlay.style.transition = 'opacity 0.2s ease';
  }

  /**
   * Update overlay content
   */
  private updateOverlay(
    content: string,
    borderColor: string,
    isHtml: boolean = false,
  ): void {
    if (!this.overlay) {
      return;
    }

    if (isHtml) {
      this.overlay.innerHTML = content;
    } else {
      this.overlay.textContent = content;
    }

    this.overlay.style.borderColor = borderColor;
  }

  /**
   * Remove the overlay
   */
  private removeOverlay(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }
  }

  /**
   * Update the recognition status
   */
  private updateStatus(_status: RecognitionStatus): void {
    // Status tracking removed - can be re-added if needed for UI feedback
  }

  /**
   * Send error message to popup
   */
  private sendErrorMessage(error: string): void {
    const message: ExtensionMessage = {
      type: MessageType.ERROR,
      error,
    };

    chrome.runtime.sendMessage(message).catch((err: Error) => {
      console.error('Failed to send error message:', err);
    });
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    // Clear any pending timers
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }

    // Remove drag event listeners
    if (this.overlay) {
      this.overlay.removeEventListener(
        'mousedown',
        this.handleDragStart.bind(this),
      );
    }
    document.removeEventListener('mousemove', this.handleDragMove.bind(this));
    document.removeEventListener('mouseup', this.handleDragEnd.bind(this));

    this.removeOverlay();
    this.isActive = false;
    this.config = null;
    this.lastLineKey = null;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the controller when the content script loads
new SpeechTranslatorController();
console.log('Speech Translator content script loaded');
