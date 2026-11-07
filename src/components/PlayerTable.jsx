import { useState, useEffect } from 'react';
import { getTimeAgo, isStale } from '../utils/time';
import FixDot from './FixDot';

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
                        <th className="time-cell">Updated</th>
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
                        allPlayers.map((player, index) => {
                            const isYou = index === 0 && !!currentPlayer;
                            const offline = player.connected === false;
                            return (
                                <tr
                                    key={player.player_id || 'current'}
                                    className={`${isYou ? 'current-player-row' : ''} ${offline ? 'player-stale' : ''}`.trim()}
                                >
                                    <td className="player-name-cell">
                                        <span className="player-name-wrap">
                                            <FixDot
                                                fresh={!offline && !isStale(player.location_last_updated)}
                                                offline={offline}
                                            />
                                            <span className="player-name-text">
                                                {player.name || `Player ${player.player_id}`}
                                            </span>
                                            {isYou && <span className="current-player-indicator">you</span>}
                                        </span>
                                    </td>
                                    <td className="player-role-cell">
                                        {player.is_seeker ? 'Seeker' : 'Hider'}
                                    </td>
                                    <td className="time-cell">{getTimeAgo(player.location_last_updated)}</td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

export default PlayerTable;
