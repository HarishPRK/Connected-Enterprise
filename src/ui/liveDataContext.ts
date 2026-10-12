import { createContext, useContext } from 'react';
import type { createLiveDataStore } from './liveDataStore';

export const LiveDataContext = createContext<ReturnType<typeof createLiveDataStore> | null>(null);

export function useLiveDataStore() {
  const store = useContext(LiveDataContext);
  if (!store) throw new Error('Live data hooks must be used inside LiveDataProvider');
  return store;
}
