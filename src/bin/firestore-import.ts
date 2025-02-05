#!/usr/bin/env node
import {Command} from 'commander';
import {prompt} from 'enquirer';
import colors from 'colors';
import process from 'process';
import fs from 'fs';
import {firestoreImport} from '../lib';
import {getCredentialsFromFile, getDBReferenceFromPath, getFirestoreDBReference} from '../lib/firestore-helpers';
import {loadJsonFile} from 'load-json-file';
import {
  accountCredentialsEnvironmentKey,
  ActionAbortedError,
  buildOption,
  commandLineParams as params,
  packageInfo,
} from './bin-common';

const program = new Command();

program
  .name(packageInfo.name)
  .description(packageInfo.description)
  .version(packageInfo.version);

program
  .option(...buildOption(params.accountCredentialsPath))
  .option(...buildOption(params.backupFileImport))
  .option(...buildOption(params.nodePath))
  .option(...buildOption(params.yesToImport))
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

const backupFile = program.opts()[params.backupFileImport.key];
if (!backupFile) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(params.backupFileImport.key) + ' - ' + params.backupFileImport.description);
  program.help();
  process.exit(1);
}

if (!fs.existsSync(backupFile)) {
  console.log(colors.bold(colors.red('Backup file does not exist: ')) + colors.bold(backupFile));
  program.help();
  process.exit(1);
}

const databaseId = program.opts()[params.databaseId.key];
const nodePath = program.opts()[params.nodePath.key];

const unattendedConfirmation = program.opts()[params.yesToImport.key];

(async () => {
  const credentials = await getCredentialsFromFile(accountCredentialsPath);
  const db = getFirestoreDBReference(credentials, databaseId);
  const pathReference = await getDBReferenceFromPath(db, nodePath);
  const data = await loadJsonFile(backupFile);

  if (!unattendedConfirmation) {
    const nodeLocation = (<FirebaseFirestore.DocumentReference | FirebaseFirestore.CollectionReference>pathReference)
      .path || '[database root]';
    const projectID = process.env.FIRESTORE_EMULATOR_HOST || (credentials as any).project_id;
    const importText = `About to import data '${backupFile}' to the '${projectID}' firestore at '${nodeLocation}'.`;

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

