// Records one clip with expo-audio: 16 kHz mono AAC (.m4a), saved straight into app storage
// (not the cache) so the evidence survives. Android's recorder cannot write WAV; the server
// and the on-device engine resample to 16 kHz PCM themselves.
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

const OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  directory: 'document',
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

export const CLIP_MIME = Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a';

export type RecordedClip = { uri: string; durationMs: number };

export function useClipRecorder() {
  const recorder = useAudioRecorder(OPTIONS);
  const state = useAudioRecorderState(recorder, 250);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  const start = async (): Promise<boolean> => {
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Allow the microphone to record.');
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording');
      return false;
    }
  };

  const stop = async (): Promise<RecordedClip | null> => {
    const durationMs = state.durationMillis || Date.now() - startedAt.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop recording');
      return null;
    }
    if (!recorder.uri) {
      setError('The recording was not saved. Try again.');
      return null;
    }
    return { uri: recorder.uri, durationMs };
  };

  return { start, stop, isRecording: state.isRecording, durationMs: state.durationMillis, metering: state.metering, error };
}
