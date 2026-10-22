import { mountPage, renderPage } from './pages';

const routes = [
    { hash: '#home', label: 'Home' },
    { hash: '#data', label: 'Adverse Data' },
    { hash: '#map', label: 'Interactive Map' },
    { hash: '#practices', label: 'Farm Practices' },
    { hash: '#login', label: 'Login' },
] as const;

function render(): void {
    const app = document.querySelector<HTMLElement>('#app');
    const nav = document.querySelector<HTMLElement>('#nav');

    if (!app || !nav) {
        throw new Error('The application shell is missing its navigation or page container.');
    }

    let route = routes.find(({ hash }) => hash === window.location.hash);
    if (!route) {
        route = routes[0];
        window.history.replaceState(null, '', route.hash);
    }

    nav.innerHTML = routes.map(({ hash, label }) => `
    <a href="${hash}"${hash === route.hash ? ' aria-current="page"' : ''}>${label}</a>
  `).join('');
    app.innerHTML = renderPage(route.label);
    mountPage(route.label);
    document.title = `${route.label} | Bicol Rice Stress Hub`;
}

export function startRouter(): void {
    window.addEventListener('hashchange', () => {
        render();
        window.scrollTo(0, 0);
    });
    render();
}