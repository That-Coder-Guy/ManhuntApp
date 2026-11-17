import { IonApp, setupIonicReact } from '@ionic/react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Settings from './pages/Settings';
import ErrorBoundary from './components/ErrorBoundary';
import InstallOffer from './components/InstallOffer';
import PermissionsSetup from './components/PermissionsSetup';

// Ionic components only — routing stays on react-router v7 (Ionic's own router
// binding requires react-router v5), so pages render without native transitions.
// mode: 'ios' renders Apple-style components on every platform to match the
// liquid-glass theme in index.css.
setupIonicReact({ mode: 'ios' });

function App() {
    return (
    <IonApp>
        <ErrorBoundary>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/lobby/:lobby_id" element={<Lobby />} />
                    <Route path="/settings" element={<Settings />} />
                </Routes>
            </BrowserRouter>
            {/* The browser offers to install; the installed app asks for permissions */}
            <InstallOffer />
            <PermissionsSetup />
        </ErrorBoundary>
    </IonApp>
  )
}

export default App;
