import '@testing-library/jest-dom';

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

// Console noise control (silence by default, allow opt-in via env variable)
const allowConsoleOutput = process.env.JEST_ALLOW_CONSOLE === 'true';

if (!allowConsoleOutput) {
  const silencedMethods = ['log', 'info', 'warn', 'debug', 'error'] as const;
  const originalConsole: Partial<Record<(typeof silencedMethods)[number], (...args: any[]) => void>> = {};

  beforeAll(() => {
    silencedMethods.forEach(method => {
      const original = console[method].bind(console);
      originalConsole[method] = original;

      (console as any)[method] = (...args: any[]) => {
        if (
          method === 'error' &&
          typeof args[0] === 'string' &&
          args[0].includes('Warning: ReactDOM.render is no longer supported')
        ) {
          return;
        }
        // Suppress all console output during tests to keep results clean.
      };
    });
  });

  afterAll(() => {
    silencedMethods.forEach(method => {
      const original = originalConsole[method];
      if (original) {
        (console as any)[method] = original;
      }
    });
  });
} else {
  // Preserve previous behaviour when console output is explicitly allowed.
  const originalError = console.error;
  beforeAll(() => {
    console.error = (...args: any[]) => {
      if (
        typeof args[0] === 'string' &&
        args[0].includes('Warning: ReactDOM.render is no longer supported')
      ) {
        return;
      }
      originalError.call(console, ...args);
    };
  });

  afterAll(() => {
    console.error = originalError;
  });
}
