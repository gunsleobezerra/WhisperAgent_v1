import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppRouter } from './hooks/useAppRouter';
import { SettingsWindow } from './components/SettingsWindow';
import { LiveOverlay } from './components/LiveOverlay';
import { PopupWindow } from './components/PopupWindow';
import { SessionSummaryWindow } from './components/SessionSummaryWindow';
import { ThemeConfig, applyThemeToDom, getStoredTheme } from './utils/theme';
import './App.css';

function App() {
  const currentWindow = useAppRouter();

  useEffect(() => {
    // Remove qualquer sombra/borda retangular nativa da janela do Windows
    try {
      getCurrentWindow().setShadow(false).catch(() => {});
    } catch {}

    // Aplica o tema salvo assim que a janela é inicializada
    const theme = getStoredTheme();
    applyThemeToDom(theme);

    // Escuta alterações de tema disparadas por qualquer janela (Settings -> Overlay)
    let unlisten: (() => void) | undefined;
    listen<ThemeConfig>('whisper-theme-changed', (event) => {
      if (event.payload) {
        applyThemeToDom(event.payload);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.warn('Tauri event listener indisponível:', err);
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  if (currentWindow === 'settings') {
    return <SettingsWindow />;
  }

  if (currentWindow === 'popup') {
    return <PopupWindow />;
  }

  if (currentWindow === 'session-summary') {
    return <SessionSummaryWindow />;
  }

  return <LiveOverlay />;
}

export default App;
