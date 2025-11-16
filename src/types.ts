/**
 * Shared TypeScript type definitions for the Speech Translator extension
 */

/**
 * Web Speech API type definitions
 * These extend the incomplete types in lib.dom.d.ts
 */
export interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

/**
 * Message types for communication between popup and content script
 */
export enum MessageType {
  START_RECOGNITION = 'START_RECOGNITION',
  STOP_RECOGNITION = 'STOP_RECOGNITION',
  STATUS_UPDATE = 'STATUS_UPDATE',
  RECOGNITION_RESULT = 'RECOGNITION_RESULT',
  TRANSLATION_RESULT = 'TRANSLATION_RESULT',
  ERROR = 'ERROR',
}

/**
 * Configuration for speech recognition and translation
 */
export interface RecognitionConfig {
  inputLang: string;
  outputLang: string;
}

/**
 * Message structure for extension communication
 */
export interface ExtensionMessage {
  type: MessageType;
  data?: any;
  config?: RecognitionConfig;
  error?: string;
}

/**
 * Status of the recognition process
 */
export enum RecognitionStatus {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  TRANSLATING = 'TRANSLATING',
  ERROR = 'ERROR',
}

/**
 * Speech recognition result
 */
export interface RecognitionResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

/**
 * Translation result from Google Translate API
 */
export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

/**
 * Google Translate API response structure (unofficial endpoint)
 */
export interface GoogleTranslateResponse {
  sentences?: Array<{
    trans?: string;
    orig?: string;
    backend?: number;
  }>;
  src?: string;
  confidence?: number;
  spell?: any;
  ld_result?: any;
}

/**
 * Storage keys for chrome.storage
 */
export enum StorageKey {
  INPUT_LANG = 'inputLang',
  OUTPUT_LANG = 'outputLang',
  IS_ACTIVE = 'isActive',
  LAST_CONFIG = 'lastConfig',
}

/**
 * Overlay position configuration
 */
export interface OverlayPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Extension state stored in chrome.storage
 */
export interface ExtensionState {
  inputLang: string;
  outputLang: string;
  isActive: boolean;
  lastConfig?: RecognitionConfig;
}
