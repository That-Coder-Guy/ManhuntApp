import { IonApp, setupIonicReact } from '@ionic/react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import ErrorBoundary from './components/ErrorBoundary';

// Ionic components only — routing stays on react-router v7 (Ionic's own router
// binding requires react-router v5), so pages render without native transitions.
setupIonicReact();

function App() {
    return (
    <IonApp>
        <ErrorBoundary>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/lobby/:lobby_id" element={<Lobby />} />
                </Routes>
            </BrowserRouter>
        </ErrorBoundary>
    </IonApp>
  )
}

export default App;
