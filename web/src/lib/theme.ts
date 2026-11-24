import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'color-scheme';

function meta() {
  return document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
}

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Three-state preference (shown in the user menu): stored override, or follow the system. */
export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked — still apply for this page */
  }
  const m = meta();
  if (m) m.content = pref === 'system' ? 'light dark' : pref;
  window.dispatchEvent(new Event('ttw:theme'));
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void, 'light' | 'dark'] {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [systemDark, setSystemDark] = useState(!!mq?.matches);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        const p = getThemePref();
        const m = meta();
        if (m) m.content = p === 'system' ? 'light dark' : p;
        setPref(p);
      }
    };
    const onLocal = () => setPref(getThemePref());
    const onMq = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    window.addEventListener('storage', onStorage);
    window.addEventListener('ttw:theme', onLocal);
    mq?.addEventListener('change', onMq);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('ttw:theme', onLocal);
      mq?.removeEventListener('change', onMq);
    };
  }, []);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  return [pref, setThemePref, resolved];
}
