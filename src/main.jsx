import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/* Ionic core + recommended CSS */
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/text-alignment.css'
import '@ionic/react/css/flex-utils.css'
/* Always-dark palette to match the game's aesthetic */
import '@ionic/react/css/palettes/dark.always.css'

import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
