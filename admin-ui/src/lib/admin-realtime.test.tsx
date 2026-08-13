import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRealtimeProvider, useAdminRealtime } from './admin-realtime';

vi.mock('./api', () => ({
  api: {
    getOperationsSummary: vi.fn(),
  },
}));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function SoundProbe() {
  const { playOrderAlarm, soundEnabled, soundReady, unlockSound } = useAdminRealtime();
  const [alarmResult, setAlarmResult] = useState<boolean | null>(null);
  return (
    <div>
      <span>{soundEnabled ? 'enabled' : 'disabled'}</span>
      <span>{soundReady ? 'ready' : 'blocked'}</span>
      <span>{alarmResult === null ? 'not-tested' : alarmResult ? 'played' : 'not-played'}</span>
      <button type="button" onClick={() => void unlockSound()}>
        Test sound
      </button>
      <button type="button" onClick={() => setAlarmResult(playOrderAlarm())}>
        Play alarm
      </button>
    </div>
  );
}

describe('admin order audio transport', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('defaults to enabled, unlocks silently on a gesture, and only tests sound explicitly', async () => {
    const oscillatorStart = vi.fn();
    const stateListeners = new Set<() => void>();
    class FakeAudioContext {
      state: AudioContextState = 'suspended';
      currentTime = 0;
      destination = {} as AudioDestinationNode;
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === 'statechange' && typeof listener === 'function') {
          stateListeners.add(listener as () => void);
        }
      }
      async resume() {
        this.state = 'running';
        for (const listener of stateListeners) listener();
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createOscillator() {
        return {
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: oscillatorStart,
          stop: vi.fn(),
          addEventListener: vi.fn(),
        };
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const user = userEvent.setup();
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );

    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(oscillatorStart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Test sound' }));
    expect(oscillatorStart).toHaveBeenCalledTimes(1);
  });

  it('respects an explicit stored sound opt-out', () => {
    localStorage.setItem('adminOrderSoundEnabled', 'false');
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );

    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('keeps sound blocked when AudioContext construction throws', async () => {
    class ThrowingAudioContext {
      constructor() {
        throw new Error('audio unavailable');
      }
    }
    vi.stubGlobal('AudioContext', ThrowingAudioContext);
    const user = userEvent.setup();
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Play alarm' }));
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('not-played')).toBeInTheDocument();
  });

  it('fails closed and releases the context when WebAudio graph creation throws', async () => {
    const close = vi.fn(async () => undefined);
    class ThrowingGraphAudioContext {
      state: AudioContextState = 'running';
      currentTime = 0;
      destination = {} as AudioDestinationNode;
      addEventListener() {}
      async resume() {}
      close = close;
      createGain() {
        throw new Error('graph unavailable');
      }
      createOscillator() {
        throw new Error('graph unavailable');
      }
    }
    vi.stubGlobal('AudioContext', ThrowingGraphAudioContext);
    const user = userEvent.setup();
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Play alarm' }));
    await waitFor(() => expect(screen.getByText('blocked')).toBeInTheDocument());
    expect(screen.getByText('not-played')).toBeInTheDocument();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
