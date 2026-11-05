// The trainer contract (contract.suite.ts) for actor-critic. (A_RP has its own file: one file of both ran past
// vitest's 60 s worker timeout once the tracks got longer in B5.)
import { contractSuite } from './contract.suite';
import './actorCritic';

contractSuite(['ac']);
