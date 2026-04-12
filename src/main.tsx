import { createRoot } from 'react-dom/client';
import { AppProvider } from './store/context';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>
);
