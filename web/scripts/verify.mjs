import { verifyExport } from './deployment.mjs';

console.log(JSON.stringify(await verifyExport(), null, 2));
