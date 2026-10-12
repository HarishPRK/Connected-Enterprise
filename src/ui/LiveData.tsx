import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from './Toast';
import { createLiveDataStore } from './liveDataStore';
import { LiveDataContext } from './liveDataContext';
export { useLiveData } from './useLiveData';

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const { push } = useToast();
  const [store] = useState(createLiveDataStore);
  useEffect(() => { store.start(push); return () => store.stop(); }, [store, push]);
  return <LiveDataContext.Provider value={store}>{children}</LiveDataContext.Provider>;
}
