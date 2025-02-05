#!/usr/bin/env node
import {Command} from 'commander';
import colors from 'colors';
import process from 'process';
import fs from 'fs';
import {firestoreExport} from '../lib';
import {getCredentialsFromFile, getDBReferenceFromPath, getFirestoreDBReference} from '../lib/firestore-helpers';
import {accountCredentialsEnvironmentKey, buildOption, commandLineParams as params, packageInfo, isPathFile, isPathFolder} from './bin-common';

const program = new Command();

program
  .name(packageInfo.name)
  .description(packageInfo.description)
  .version(packageInfo.version);

program
  .option(...buildOption(params.accountCredentialsPath))
  .option(...buildOption(params.backupPathExport))
  .option(...buildOption(params.nodePath))
  .option(...buildOption(params.prettyPrint))
  .option(...buildOption(params.databaseId))
  .parse(process.argv);

const accountCredentialsPath = program.opts()[params.accountCredentialsPath.key] || process.env[accountCredentialsEnvironmentKey];
if (!accountCredentialsPath) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(params.accountCredentialsPath.key) + ' - ' + params.accountCredentialsPath.description);
  program.help();
  process.exit(1);
}

if (!fs.existsSync(accountCredentialsPath)) {
  console.log(colors.bold(colors.red('Account credentials file does not exist: ')) + colors.bold(accountCredentialsPath));
  program.help();
  process.exit(1);
}

const backupPath = program.opts()[params.backupPathExport.key];
if (!backupPath) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(params.backupPathExport.key) + ' - ' + params.backupPathExport.description);
  program.help();
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

const databaseId = program.opts()[params.databaseId.key];
const prettyPrint = Boolean(program.opts()[params.prettyPrint.key]);
const nodePath = program.opts()[params.nodePath.key];

(async () => {
  console.log(`Getting Credentials from ${accountCredentialsPath}`);
  const credentials = await getCredentialsFromFile(accountCredentialsPath);
  console.log('Getting Firestore DB Reference');
  const db = getFirestoreDBReference(credentials, databaseId);
  console.log(`Getting DB Reference for database ${databaseId}`);
  const pathReference = getDBReferenceFromPath(db, nodePath);
  console.log(colors.bold(colors.green('Starting Export 🏋️')));
  const results = await firestoreExport(pathReference, true);
  console.log(colors.bold('Export from Firestore complete 🏋️') + ' - Results: ' + results);
  const stringResults = JSON.stringify(results, undefined, prettyPrint ? 2 : undefined);
  console.log('Results: ' + stringResults);

  console.log('Saving Results');
  if (isPathFile(backupPath)) {
    await writeResults(stringResults, backupPath);
    console.log(colors.yellow(`Results were saved to ${backupPath}`));
    console.log(colors.bold(colors.green('All done 🎉')));
    return;
  } else if (isPathFolder(backupPath)) {
    const collections = results['__collections__'];
    if (!collections || Object.keys(collections).length === 0) {
      console.log(colors.bold(colors.red('No collections were found')));
      process.exit(1);
    }
    const collectionNames = Object.keys(collections);
    for (const collectionName of collectionNames) {
      const collectionBackupFile = `${backupPath}/${collectionName}.json`;
      const collectionResults = {
        [collectionName]: collections[collectionName]
      }
      const collectionStringResults = JSON.stringify(collectionResults, undefined, prettyPrint ? 2 : undefined);
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



