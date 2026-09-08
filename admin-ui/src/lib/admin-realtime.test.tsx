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
  const { playOrderAlarm, stopOrderAlarm, setSoundEnabled, soundEnabled, soundReady, unlockSound } =
    useAdminRealtime();
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
      <button onClick={() => playOrderAlarm(true)}>Kitchen siren</button>
      <button onClick={stopOrderAlarm}>Stop siren</button>
      <button onClick={() => setSoundEnabled(false)}>Mute</button>
    </div>
  );
}

describe('admin order audio transport', () => {
  beforeEach(() => {
    delete window.BulkaOrderAudio;
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('uses the native audio player after the WebView bridge arrives and remembers mute', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const view = render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );
    const native = {
      prepare: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    window.BulkaOrderAudio = native;
    fireEvent(window, new Event('bulka:order-audio-ready'));
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(native.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Kitchen siren'));
    expect(native.play).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Mute'));
    expect(native.stop).toHaveBeenCalled();
    expect(localStorage.getItem('adminOrderSoundEnabled')).toBe('false');
    view.unmount();
    native.prepare.mockClear();
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(native.prepare).not.toHaveBeenCalled();
  });

  it('shows unavailable audio when the native player reports failure', async () => {
    window.BulkaOrderAudio = {
      prepare: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockRejectedValue(new Error('device unavailable')),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Kitchen siren'));
    await waitFor(() => expect(screen.getByText('blocked')).toBeInTheDocument());
  });

  it('restores enabled audio silently on mount and only tests sound explicitly', async () => {
    const oscillatorStart = vi.fn();
    const resume = vi.fn();
    let activeContext: FakeAudioContext;
    const stateListeners = new Set<() => void>();
    class FakeAudioContext {
      constructor() {
        activeContext = this;
      }
      state: AudioContextState = 'suspended';
      currentTime = 0;
      destination = {} as AudioDestinationNode;
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === 'statechange' && typeof listener === 'function') {
          stateListeners.add(listener as () => void);
        }
      }
      async resume() {
        resume();
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
    const view = render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );

    expect(screen.getByText('enabled')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(oscillatorStart).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledTimes(1);

    activeContext!.state = 'suspended';
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    expect(oscillatorStart).not.toHaveBeenCalled();

    view.unmount();
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(resume).toHaveBeenCalledTimes(3);
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

  it('plays a louder ten-second siren without overlap and stops immediately on acceptance or mute', () => {
    const stop = vi.fn();
    const start = vi.fn();
    const ramp = vi.fn();
    const disconnect = vi.fn();
    class RunningAudioContext {
      state = 'running';
      currentTime = 100;
      destination = {};
      addEventListener() {}
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: ramp },
          connect: vi.fn(),
          disconnect,
        };
      }
      createOscillator() {
        return {
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect,
          start,
          stop,
          addEventListener: vi.fn(),
        };
      }
    }
    vi.stubGlobal('AudioContext', RunningAudioContext);
    render(
      <AdminRealtimeProvider branchId="branch-1" role="cashier">
        <SoundProbe />
      </AdminRealtimeProvider>,
    );
    fireEvent.click(screen.getByText('Kitchen siren'));
    expect(stop).toHaveBeenCalledWith(110);
    expect(ramp).toHaveBeenCalledWith(0.5, 100.03);
    fireEvent.click(screen.getByText('Kitchen siren'));
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Stop siren'));
    expect(stop).toHaveBeenLastCalledWith();
    expect(disconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Kitchen siren'));
    expect(start).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Mute'));
    expect(stop).toHaveBeenLastCalledWith();
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
