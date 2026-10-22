import 'leaflet/dist/leaflet.css';
import './style.css';
import { startRouter } from './router';

document.querySelector<HTMLDivElement>('#site')!.innerHTML = `
  <header class="top">
    <div class="wrap">
      <a class="brand" href="#home" aria-label="Bicol Rice Stress Hub home">
        <img class="logo" src="/images/logo-da.png" alt="Department of Agriculture Bicol Region logo" width="62" height="55" />
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
      <div class="footer-grid">
        <section aria-labelledby="footer-contact-title">
          <h2 id="footer-contact-title">Contact Information</h2>
          <ul class="footer-contact-list">
            <li>
              <svg class="footer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
              <span>Regional Field Office No. V, San Agustin, Pili, Camarines Sur</span>
            </li>
            <li>
              <svg class="footer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 11.2 19a19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.9a2 2 0 0 1-.6 1.7L7.1 10a16 16 0 0 0 6 6l1.7-1.9a2 2 0 0 1 1.7-.6l2.9.5a2 2 0 0 1 1.6 1.9Z"/></svg>
              <a href="tel:+63544772378">(054) 477-2378</a>
            </li>
            <li>
              <svg class="footer-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
              <a href="mailto:da5@da.gov.ph">da5@da.gov.ph</a>
            </li>
          </ul>
        </section>
        <section aria-labelledby="footer-about-title">
          <h2 id="footer-about-title">About the Project</h2>
          <p>The Adverse Rice Area Information Hub is an initiative by the Department of Agriculture Region V to provide reference information on rice production areas affected by drought, floods, saline intrusion, pests, and diseases.</p>
          <a class="footer-visit" href="https://bicol.da.gov.ph/" target="_blank" rel="noopener noreferrer">
            Visit DA Region V Website
            <svg class="footer-external" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          </a>
        </section>
      </div>
      <div class="footer-bottom">
        <p>© 2025 Department of Agriculture - Region V. All rights reserved.</p>
      </div>
    </div>
  </footer>
`;

startRouter();