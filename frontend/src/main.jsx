import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { createApiClient } from './api/client.js';
import { ApiProvider, createQueryClient } from './api/hooks.js';
import { ToastProvider } from './components/Toast.jsx';
import './index.css';

const queryClient = createQueryClient();
const apiClient = createApiClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={apiClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
