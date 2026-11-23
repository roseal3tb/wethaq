import React from 'react'; import { createRoot } from 'react-dom/client'; import App from './App'; import './styles.css'; import './theme/dark.css'; import './theme/polish.css';
import './theme/workspace.css';
import './theme/motion.css';
import './theme/appearance.css';
import './theme/login-flow.css';
import './theme/qa-fixes.css';
import './theme/ui-consistency.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
