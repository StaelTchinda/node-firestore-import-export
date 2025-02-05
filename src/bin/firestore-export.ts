#!/usr/bin/env node
import commander from 'commander';
import colors from 'colors';
import process from 'process';
import fs from 'fs';
import {firestoreExport} from '../lib';
import {getCredentialsFromFile, getDBReferenceFromPath, getFirestoreDBReference} from '../lib/firestore-helpers';
import {accountCredentialsEnvironmentKey, buildOption, commandLineParams as params, packageInfo, isPathFile, isPathFolder} from './bin-common';

commander.version(packageInfo.version)
  .option(...buildOption(params.accountCredentialsPath))
  .option(...buildOption(params.backupPathExport))
  .option(...buildOption(params.nodePath))
  .option(...buildOption(params.prettyPrint))
  .parse(process.argv);

const accountCredentialsPath = commander[params.accountCredentialsPath.key] || process.env[accountCredentialsEnvironmentKey];
if (!accountCredentialsPath) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(params.accountCredentialsPath.key) + ' - ' + params.accountCredentialsPath.description);
  commander.help();
  process.exit(1);
}

if (!fs.existsSync(accountCredentialsPath)) {
  console.log(colors.bold(colors.red('Account credentials file does not exist: ')) + colors.bold(accountCredentialsPath));
  commander.help();
  process.exit(1);
}

const backupPath = commander[params.backupPathExport.key];
if (!backupPath) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(params.backupPathExport.key) + ' - ' + params.backupPathExport.description);
  commander.help();
  process.exit(1);
}

const writeResults = (results: string, filename: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    fs.writeFile(filename, results, 'utf8', err => {
      if (err) {
        reject(err);
      } else {
        resolve(filename);
      }
    });
  });
};

const prettyPrint = Boolean(commander[params.prettyPrint.key]);
const nodePath = commander[params.nodePath.key];

(async () => {
  const credentials = await getCredentialsFromFile(accountCredentialsPath);
  const db = getFirestoreDBReference(credentials);
  const pathReference = getDBReferenceFromPath(db, nodePath);
  console.log(colors.bold(colors.green('Starting Export 🏋️')));
  const results = await firestoreExport(pathReference, true);
  const stringResults = JSON.stringify(results, undefined, prettyPrint ? 2 : undefined);
  // Check if the backup is a file or a folder. If it is a folder, we will save each collection in a separate file.
  if (isPathFile(backupPath)) {
    await writeResults(stringResults, backupPath);
    console.log(colors.yellow(`Results were saved to ${backupPath}`));
    console.log(colors.bold(colors.green('All done 🎉')));
    return;
  } else if (isPathFolder(backupPath)) {
    const collections = results['__collections__'];
    const collectionNames = Object.keys(collections);
    for (const collectionName of collectionNames) {
      const collectionBackupFile = `${backupPath}/${collectionName}.json`;
      const collectionStringResults = JSON.stringify(collections[collectionName], undefined, prettyPrint ? 2 : undefined);
      await writeResults(collectionStringResults, collectionBackupFile);
      console.log(colors.yellow(`Collection ${collectionName} was saved to ${collectionBackupFile}`));
    } 
  } else {
    console.log(colors.bold(colors.red('Backup file is not a file or a folder: ')) + colors.bold(backupPath));
    process.exit(1);
  }
})().catch((error) => {
  if (error instanceof Error) {
    console.log(colors.red(error.message));
    process.exit(1);
  } else {
    console.log(colors.red(error));
  }
});



