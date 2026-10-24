import { rehearsePublicBackup } from './backup-integrity.mjs';
const directory = process.argv[2];
if (!directory) throw new Error('백업 폴더를 지정하세요.');
console.log(JSON.stringify(rehearsePublicBackup(directory),null,1));
