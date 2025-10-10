import '@testing-library/jest-dom';
import fetch, { Headers, Request, Response } from 'cross-fetch';

// Polyfill fetch for integration tests
global.fetch = fetch;
global.Headers = Headers;
global.Request = Request;
global.Response = Response;

// Mock chrome APIs for testing
const mockChrome = {
  storage: {
    sync: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    query: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue({}),
  },
  runtime: {
    sendMessage: jest.fn().mockResolvedValue({}),
    connect: jest.fn(() => ({
      name: 'test-port',
      postMessage: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      onDisconnect: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      disconnect: jest.fn(),
    })),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    lastError: null,
  },
  commands: {
    onCommand: {
      addListener: jest.fn(),
    },
  },
};

// Global chrome object for tests
(global as any).chrome = mockChrome;

// Mock speechSynthesis for TTS tests
const mockSpeechSynthesis = {
  speak: jest.fn(),
  cancel: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  getVoices: jest.fn().mockReturnValue([]),
  speaking: false,
  pending: false,
  paused: false,
  onvoiceschanged: null,
};

(global as any).speechSynthesis = mockSpeechSynthesis;
(global as any).SpeechSynthesisUtterance = jest.fn().mockImplementation(() => ({
  text: '',
  voice: null,
  volume: 1,
  rate: 1,
  pitch: 1,
  onstart: null,
  onend: null,
  onerror: null,
  onpause: null,
  onresume: null,
  onboundary: null,
}));

// Console output suppression for tests
// Use VERBOSE_TESTS=1 environment variable to enable console output for debugging
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

const shouldSuppressConsole = process.env.VERBOSE_TESTS !== '1';

beforeAll(() => {
  if (shouldSuppressConsole) {
    // Suppress all console output to keep test output clean
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    console.debug = jest.fn();
  }
});

afterAll(() => {
  if (shouldSuppressConsole) {
    // Restore original console methods
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  }
});
