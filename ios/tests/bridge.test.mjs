// The bridge script, as the iPhone app runs it:
//
//   node --test ios/tests/bridge.test.mjs
import { bridgeSuite } from './bridge-suite.mjs';

bridgeSuite('iphone');
