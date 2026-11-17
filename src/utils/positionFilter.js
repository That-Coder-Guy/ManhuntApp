// Steadying a hider's position, for indoors.
//
// Inside a building GPS readings scatter tens of metres around the real spot,
// and the phone says so: each fix comes with an accuracy. This filter weighs
// every new fix against what it already knows by those accuracies (a
// one-dimensional Kalman filter per axis, with "the hider may have moved"
// growing with time). The upshot:
//   - Indoors, with poor fixes, it averages over many of them (the position
//     stops jumping around; a 40 m scatter settles to within ~10 m of its
//     centre after about half a minute).
//   - Outdoors, with good fixes, it follows each one almost at once, so a
//     hider who walks out of the building is shown where they are.
// What averaging can't remove is a steady offset (signals bouncing off walls
// can shift the whole scatter), only the jitter around it.

// How far the hider might have moved, as a variance growing per second
// (m²/s): enough to follow a walk outdoors within a few metres
const MOVEMENT_M2_PER_S = 3;
// Fixes claiming better than this are treated as this good, and a fix with
// no accuracy as moderately poor
const BEST_ACCURACY_M = 3;
const UNKNOWN_ACCURACY_M = 30;
const WORST_ACCURACY_M = 1000;

/**
 * A filter for one player's fixes: update({ latitude, longitude, accuracy,
 * timestamp }) returns the steadied { latitude, longitude, accuracy }, where
 * accuracy is the filter's own estimate (in metres) of how well it knows the
 * spot, not counting a steady offset.
 */
export function createPositionFilter()
{
    let state = null; // { latitude, longitude, variance (m²), time (ms) }

    return {
        update({ latitude, longitude, accuracy, timestamp = Date.now() })
        {
            const measured = Math.min(WORST_ACCURACY_M, Math.max(BEST_ACCURACY_M, Number.isFinite(accuracy) ? accuracy : UNKNOWN_ACCURACY_M));
            const noise = measured ** 2;

            if (!state)
            {
                state = { latitude, longitude, variance: noise, time: timestamp };
                return { latitude, longitude, accuracy: measured };
            }

            const seconds = Math.max(0, (timestamp - state.time) / 1000);
            const predicted = state.variance + MOVEMENT_M2_PER_S * seconds;
            const gain = predicted / (predicted + noise);

            state = {
                latitude: state.latitude + gain * (latitude - state.latitude),
                longitude: state.longitude + gain * (longitude - state.longitude),
                variance: (1 - gain) * predicted,
                time: Math.max(state.time, timestamp)
            };
            return { latitude: state.latitude, longitude: state.longitude, accuracy: Math.sqrt(state.variance) };
        },
        reset()
        {
            state = null;
        }
    };
}

