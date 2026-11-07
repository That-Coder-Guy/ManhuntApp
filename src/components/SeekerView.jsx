import { useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { chevronBackOutline } from 'ionicons/icons';
import CompassArrow from './CompassArrow';
import useNow from '../hooks/useNow';
import { calculateDistance } from '../utils/geo';
import { PlayerListCard, PlayerRow } from './PlayerList';
import { playerName } from '../utils/players';

const TEST_IDS = {
    card: 'targets-card', title: 'targets-title', list: 'targets-list', empty: 'no-targets',
    row: 'target-card', name: 'target-name', distance: 'target-distance'
};

function SeekerView({ players, avatars = {}, currentLocation })
{
    const now = useNow();
    const [selectedId, setSelectedId] = useState(null);

    const hiders = players.filter((player) => !player.is_seeker);
    const distanceTo = (player) =>
        calculateDistance(currentLocation.latitude, currentLocation.longitude, player.latitude, player.longitude);

    // A selected hider who left or switched roles simply drops back to the list
    const selected = hiders.find((h) => h.player_id === selectedId);

    if (selected)
    {
        return (
            <div className="compass-screen" data-testid="compass-screen">
                <IonButton
                    data-testid="compass-back"
                    fill="clear"
                    size="small"
                    className="compass-back-btn"
                    onClick={() => setSelectedId(null)}
                >
                    <IonIcon slot="start" icon={chevronBackOutline} />
                    All hiders
                </IonButton>
                <CompassArrow
                    target={selected}
                    targetName={playerName(selected)}
                    currentLocation={currentLocation}
                    distance={distanceTo(selected)}
                    onClick={() => setSelectedId(null)}
                />
            </div>
        );
    }

    return (
        <PlayerListCard title="Hiders" count={hiders.length} emptyText="No hiders in this lobby yet" testIds={TEST_IDS}>
            {hiders.map((hider) => (
                <PlayerRow
                    key={hider.player_id}
                    player={hider}
                    avatar={avatars[hider.player_id]}
                    distance={distanceTo(hider)}
                    now={now}
                    onClick={() => setSelectedId(hider.player_id)}
                    testIds={TEST_IDS}
                />
            ))}
        </PlayerListCard>
    );
}

export default SeekerView;
