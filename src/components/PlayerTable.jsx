import useNow from '../hooks/useNow';
import { getTimeAgo } from '../utils/time';
import { playerFreshness, playerName } from '../utils/players';
import FixDot from './FixDot';

function PlayerTable({ players, currentPlayer })
{
    const now = useNow();
    const rows = currentPlayer ? [{ ...currentPlayer, isYou: true }, ...players] : players;

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
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan="3" className="no-players-cell">No players yet</td>
                        </tr>
                    ) : rows.map((player) => {
                        const { fresh, offline } = playerFreshness(player, now);
                        return (
                            <tr
                                key={player.isYou ? 'you' : player.player_id}
                                className={`${player.isYou ? 'current-player-row' : ''} ${offline ? 'player-stale' : ''}`.trim()}
                            >
                                <td className="player-name-cell">
                                    <span className="player-name-wrap">
                                        <FixDot fresh={fresh} offline={offline} />
                                        <span className="player-name-text">{playerName(player)}</span>
                                        {player.isYou && <span className="current-player-indicator">you</span>}
                                    </span>
                                </td>
                                <td className="player-role-cell">{player.is_seeker ? 'Seeker' : 'Hider'}</td>
                                <td className="time-cell">{getTimeAgo(player.location_last_updated, now)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default PlayerTable;
