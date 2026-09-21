import { useCallback, useEffect, useRef, useState } from 'react';
import { hasNativePlugin, isNative } from '../platform/env';
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from './speechTypes';

export interface SpeechController {
  /** False when neither the Web Speech API nor the native plugin is usable. */
  supported: boolean;
  listening: boolean;
  /** Text recognised so far in the current utterance (not yet committed). */
  interim: string;
  error: string;
  toggle: () => void;
  stop: () => void;
}

const LANG = 'ja-JP';

/**
 * Speech → text for the memo field.
 *
 * Only the recognised text is kept; no audio is ever stored (spec §6, §23).
 * The microphone permission is requested by the platform at the moment the
 * user presses the mic button, never up front.
 */
export function useSpeechInput(onFinalText: (text: string) => void): SpeechController {
  const nativePlugin = isNative() && hasNativePlugin('SpeechRecognition');
  const [supported, setSupported] = useState(() => nativePlugin || !!getSpeechRecognitionCtor());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');

  const webRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef(onFinalText);
  finalRef.current = onFinalText;
  const nativeCleanup = useRef<(() => void) | null>(null);

  /* ---------------------------------------------------------------- native */

  const startNative = useCallback(async () => {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      const available = await SpeechRecognition.available();
      if (!available.available) {
        setSupported(false);
        setError('この端末では音声入力を利用できません。');
        return;
      }
      const perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== 'granted') {
        setError('マイクの使用が許可されていません。');
        return;
      }

      const listener = await SpeechRecognition.addListener('partialResults', (data) => {
        const text = data.matches?.[0] ?? '';
        if (text) setInterim(text);
      });
      nativeCleanup.current = () => {
        listener.remove();
        SpeechRecognition.stop().catch(() => {});
      };

      setListening(true);
      setError('');
      const result = await SpeechRecognition.start({
        language: LANG,
        maxResults: 1,
        partialResults: true,
        popup: false,
      });
      const text = (result as { matches?: string[] } | undefined)?.matches?.[0] ?? '';
      if (text) finalRef.current(text);
    } catch {
      setError('音声入力を開始できませんでした。');
    } finally {
      setInterim('');
      setListening(false);
      nativeCleanup.current?.();
      nativeCleanup.current = null;
    }
  }, []);

  /* ------------------------------------------------------------------- web */

  const startWeb = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = LANG;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError('');
    };
    recognition.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (text.trim()) finalRef.current(text.trim());
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('マイクの使用が許可されていません。');
      } else if (event.error === 'no-speech') {
        setError('音声を認識できませんでした。');
      } else if (event.error !== 'aborted') {
        setError('音声入力に失敗しました。');
      }
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
      webRef.current = null;
    };

    webRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setError('音声入力を開始できませんでした。');
      webRef.current = null;
    }
  }, []);

  /* ---------------------------------------------------------------- public */

  const stop = useCallback(() => {
    webRef.current?.stop();
    nativeCleanup.current?.();
    nativeCleanup.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    setError('');
    if (nativePlugin) void startNative();
    else startWeb();
  }, [listening, nativePlugin, startNative, startWeb, stop]);

  useEffect(() => () => stop(), [stop]);

  return { supported, listening, interim, error, toggle, stop };
}
