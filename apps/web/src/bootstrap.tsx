import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import './styles/index.css';
import 'leaflet/dist/leaflet.css';

export function mountApp() {
  createRoot(document.getElementById('root')!).render(<App />);
}
