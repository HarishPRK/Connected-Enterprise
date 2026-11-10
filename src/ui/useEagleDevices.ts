import { useCallback, useEffect, useState } from 'react';
import { isEagleDeviceSerial } from '../../shared/eagleTelemetry';

export function parseEagleDevicesResponse(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('devices' in value)
    || !Array.isArray(value.devices)
    || !value.devices.every((serial: unknown) => typeof serial === 'string' && isEagleDeviceSerial(serial))) {
    throw new Error('The device service returned an invalid list.');
  }
  return [...new Set(value.devices as string[])].sort();
}

export function useEagleDevices() {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ devices: string[]; loading: boolean; error: string | null }>({
    devices: [], loading: true, error: null,
  });
  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    setVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/hardware-metrics/devices', { headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load devices from InfluxDB. Retry the device list.');
        return parseEagleDevicesResponse(await response.json());
      })
      .then((devices) => {
        if (!controller.signal.aborted) setState({ devices, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, loading: false,
          error: error instanceof Error ? error.message : 'Unable to load devices.' }));
      });
    return () => controller.abort();
  }, [version]);
  return { ...state, refresh };
}
