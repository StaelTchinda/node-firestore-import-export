#!/usr/bin/env node
import {Command} from 'commander';
import {prompt} from 'enquirer';
import colors from 'colors';
import process from 'process';
import fs from 'fs';
import {firestoreImport} from '../lib';
import {getCredentialsFromFile, getDBReferenceFromPath, getFirestoreDBReference} from '../lib/firestore-helpers';
import { getJsonFromFile } from '../lib/helpers';
import {
  accountCredentialsEnvironmentKey,
  ActionAbortedError,
  buildOption,
  commandLineParams as params,
  packageInfo,
  isPathFile,
  isPathFolder,
} from './bin-common';

const program = new Command();

program
  .name(packageInfo.name)
  .description(packageInfo.description)
  .version(packageInfo.version);

program
  .option(...buildOption(params.accountCredentialsPath))
  .option(...buildOption(params.backupPathImport))
  .option(...buildOption(params.nodePath))
  .option(...buildOption(params.yesToImport))
  .option(...buildOption(params.databaseId))
  .parse(process.argv);

const options = program.opts();

const accountCredentialsPath = options[params.accountCredentialsPath.key] || process.env[accountCredentialsEnvironmentKey];
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

const backupPath = options[params.backupPathImport.key];
if (!backupPath) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(params.backupPathImport.key) + ' - ' + params.backupPathImport.description);
  program.help();
  process.exit(1);
}

if (!fs.existsSync(backupPath)) {
  console.log(colors.bold(colors.red('Backup file does not exist: ')) + colors.bold(backupPath));
  program.help();
  process.exit(1);
}

const databaseId = options[params.databaseId.key];
const nodePath = options[params.nodePath.key];

const unattendedConfirmation = options[params.yesToImport.key];

(async () => {
  const credentials = await getCredentialsFromFile(accountCredentialsPath);
  const db = getFirestoreDBReference(credentials, databaseId);
  const pathReference = await getDBReferenceFromPath(db, nodePath);
  let data: any;
  if (isPathFile(backupPath)) {
    if (!backupPath.endsWith('.json')) {
      throw new Error('Backup file has to be a json file.');
    }
    data = await getJsonFromFile(backupPath);
  } else if (isPathFolder(backupPath)) {
    const files = fs.readdirSync(backupPath).filter((file) => file.endsWith('.json'));
    data = {'__collections__': {}};
    for (const file of files) {
      const collectionData = await getJsonFromFile<Record<string, any>>(`${backupPath}/${file}`);
      for (const key in collectionData) {
        data['__collections__'][key] = collectionData[key];
      }
    }
  } else {
    console.log(colors.bold(colors.red('Backup path has to be a file or a folder.')));
    process.exit(1);
  }

  if (!unattendedConfirmation) {
    const nodeLocation = (<FirebaseFirestore.DocumentReference | FirebaseFirestore.CollectionReference>pathReference)
      .path || '[database root]';
    const projectID = process.env.FIRESTORE_EMULATOR_HOST || (credentials as any).project_id;
    const importText = `About to import data '${backupPath}' to the '${projectID}' firestore database with ID '${databaseId}' starting at '${nodeLocation}'.`;

    console.log(`\n\n${colors.bold(colors.blue(importText))}`);
    console.log(colors.bgYellow(colors.blue(' === Warning: This will overwrite existing data. Do you want to proceed? === ')));

    const response: { continue: boolean } = await prompt({
      type: 'confirm',
      name: 'continue',
      message: 'Proceed with import?',
    });
    if (!response.continue) {
      throw new ActionAbortedError('Import Aborted');
    }

  }

  console.log(colors.bold(colors.green('Starting Import 🏋️')));
  await firestoreImport(data, pathReference, true, true);
  console.log(colors.bold(colors.green('All done 🎉')));
})().catch((error) => {
  if (error instanceof ActionAbortedError) {
    console.log(error.message);
  } else if (error instanceof Error) {
    console.log(colors.red(`${error.name}: ${error.message}`));
    console.log(colors.red(error.stack as string));
    process.exit(1);
  } else {
    console.log(colors.red(error));
  }
});