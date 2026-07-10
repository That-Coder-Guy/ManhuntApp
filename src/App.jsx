import { Routes, Route, BrowserRouter } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
    return (
    <ErrorBoundary>
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/lobby/:lobby_id" element={<Lobby />} />
            </Routes>
        </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App;
