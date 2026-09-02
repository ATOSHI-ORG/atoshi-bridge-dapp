import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { I18nProvider } from './i18n.tsx';
import { WalletProvider } from './wallet/WalletProvider.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </WalletProvider>
  </StrictMode>,
);

