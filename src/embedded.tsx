import React from 'react';
import ReactDOM from 'react-dom/client';
import 'animal-island-ui/style';
import App from './App';
import './styles/app.css';

document.documentElement.classList.add('gllue-shell-embedded');
document.body.innerHTML = '<div id="gllue-shell-root"></div>';

ReactDOM.createRoot(document.getElementById('gllue-shell-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
