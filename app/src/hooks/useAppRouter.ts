import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type AppWindow = 'settings' | 'overlay' | 'popup';

function getInitialWindow(): AppWindow {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const winParam = searchParams.get('window');
    if (winParam === 'settings') {
      return 'settings';
    }
    if (winParam === 'popup') {
      return 'popup';
    }
  } catch {}

  try {
    const label = getCurrentWindow().label;
    if (label === 'main' || label === 'settings') {
      return 'settings';
    }
    if (label === 'popup') {
      return 'popup';
    }
    if (label === 'overlay') {
      return 'overlay';
    }
  } catch {
    // Silently fallback if not in Tauri
  }

  return 'overlay';
}

export function useAppRouter(): AppWindow {
  const [currentWindow, setCurrentWindow] = useState<AppWindow>(getInitialWindow);

  useEffect(() => {
    setCurrentWindow(getInitialWindow());
  }, []);

  return currentWindow;
}
