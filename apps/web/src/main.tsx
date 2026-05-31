import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import './styles/index.css';
// Leaflet ships its base styles as a sibling asset (zoom controls, the
// .leaflet-container reset, the attribution prompt). The component-scope
// import in LocationMap.tsx already pulls it in, but importing it here
// too means the styles are guaranteed to be in the bundle even if a
// future code-split lazy-loads LocationMap.
import 'leaflet/dist/leaflet.css';

createRoot(document.getElementById('root')!).render(<App />);
