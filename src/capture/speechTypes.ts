/**
 * Minimal Web Speech API typings — `SpeechRecognition` is still not in the
 * standard DOM lib, and Safari only exposes the `webkit` prefixed form.
 */
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): Ctor | null {
  const w = window as unknown as {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
