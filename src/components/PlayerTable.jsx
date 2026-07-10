import { useState, useEffect } from 'react';
import { getTimeAgo } from '../utils/time';

function PlayerTable({ players, currentPlayer })
{
    // State to force re-render for time updates
    const [, setTick] = useState(0);

    // Effect to update "time ago" display every second
    useEffect(() =>
    {
        const intervalId = setInterval(() =>
        {
            setTick(prev => prev + 1);
        }, 1000);
        return () => clearInterval(intervalId);
    }, []);

    // Combine current player and other players
    const allPlayers = currentPlayer ? [currentPlayer, ...players] : players;

    return (
        <div className="player-table-container">
            <table className="player-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Last Updated</th>
                    </tr>
                </thead>
                <tbody>
                    {allPlayers.length === 0 ? (
                        <tr>
                            <td colSpan="3" className="no-players-cell">
                                No players in lobby
                            </td>
                        </tr>
                    ) : (
                        allPlayers.map((player, index) => (
                            <tr
                                key={player.player_id || 'current'}
                                className={`${index === 0 && currentPlayer ? 'current-player-row' : ''} ${player.connected === false ? 'player-stale' : ''}`.trim()}
                            >
                                <td className="player-name-cell">
                                    {player.name || `Player ${player.player_id}`}
                                    {index === 0 && currentPlayer && <span className="current-player-indicator"> (You)</span>}
                                    {player.connected === false && <span className="player-offline-indicator"> (offline)</span>}
                                </td>
                                <td>
                                    <span className={`player-role-badge ${player.is_seeker ? 'seeker' : 'hider'}`}>
                                        {player.is_seeker ? 'Seeker' : 'Hider'}
                                    </span>
                                </td>
                                <td className="time-cell">{getTimeAgo(player.location_last_updated)}</td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

export default PlayerTable;
