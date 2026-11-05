// The trainer contract (contract.suite.ts) for actor-critic and A_RP.
import { contractSuite } from './contract.suite';
import './actorCritic';
import './arp';

contractSuite(['ac', 'arp']);
