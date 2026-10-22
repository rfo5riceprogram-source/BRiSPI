import 'leaflet/dist/leaflet.css';
import './style.css';
import { startRouter } from './router';

document.querySelector<HTMLDivElement>('#site')!.innerHTML = `
  <header class="top">
    <div class="wrap">
      <a class="brand" href="#home" aria-label="Bicol Rice Stress Hub home">
        <span>
          <small>Department of Agriculture Region 5</small>
          <small class="addr">DA Regional Field Office V · San Agustin, Pili, Camarines Sur</small>
          <b>Bicol Rice Stress Prone Information Hub</b>
        </span>
      </a>
      <nav class="pills" id="nav" aria-label="Main"></nav>
    </div>
  </header>
  <main class="wrap" id="app" tabindex="-1"></main>
  <footer class="bot">
    <div class="wrap">
      <div>
        <b style="font-family:var(--serif);font-size:1.1rem">ARIAH</b>
        <p>A reference dataset of the latest DA records on flood, drought and saline-intrusion stress in Bicol rice areas. It is not a real-time monitoring system.</p>
      </div>
    </div>
  </footer>
`;

startRouter();