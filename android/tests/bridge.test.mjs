// The bridge script, as the Android app runs it (the tests themselves are
// shared with the iPhone app: ios/tests/bridge-suite.mjs):
//
//   node --test android/tests/bridge.test.mjs
import { bridgeSuite } from '../../ios/tests/bridge-suite.mjs';

bridgeSuite('android');
