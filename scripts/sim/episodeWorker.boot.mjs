// Worker entry: register the TypeScript loader inside this worker (loader hooks are per thread), then load the worker.
import { register } from 'tsx/esm/api';
register();
await import('./episodeWorker.ts');
