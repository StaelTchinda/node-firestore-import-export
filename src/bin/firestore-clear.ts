#!/usr/bin/env node
import { Command } from "commander";
import colors from "colors";
import process from "process";
import fs from "fs";
import {
  getCredentialsFromFile,
  getDBReferenceFromPath,
  getFirestoreDBReference,
  sleep,
} from "../lib/firestore-helpers";
import { firestoreClear } from "../lib";
import { prompt } from "enquirer";
import {
  accountCredentialsEnvironmentKey,
  ActionAbortedError,
  buildOption,
  commandLineParams as params,
  packageInfo,
} from "./bin-common";
import { IFirebaseCredentials } from "../interfaces/IFirebaseCredentials";

interface FirestoreClearParams {
  accountCredentialsPath: string;
  databaseId: string;
  nodePath: string;
  yesToClear: boolean;
  yesToNoWait: boolean;

  emulator: boolean;
  emulatorHost?: string;
}

function setupProgram(): Command {
  const program = new Command();
  program
    .name(packageInfo.name)
    .description(packageInfo.description)
    .version(packageInfo.version);

  program
    .option(...buildOption(params.accountCredentialsPath))
    .option(...buildOption(params.nodePath))
    .option(...buildOption(params.yesToClear))
    .option(...buildOption(params.yesToNoWait))
    .option(...buildOption(params.databaseId))
    .option(...buildOption(params.emulator))
    .option(...buildOption(params.emulatorHost))
    .parse(process.argv);

  return program;
}

function parseParams(program: Command): FirestoreClearParams {
  const options = program.opts();

  const accountCredentialsPath =
    options[params.accountCredentialsPath.key] ||
    process.env[accountCredentialsEnvironmentKey];

  const databaseId = options[params.databaseId.key];
  const nodePath = options[params.nodePath.key];

  const yesToClear = options[params.yesToClear.key];
  const yesToNoWait = options[params.yesToNoWait.key];
  const emulator = Boolean(options[params.emulator.key]);
  const emulatorHost =
    options[params.emulatorHost.key] || params.emulatorHost.defaultValue;

  return {
    accountCredentialsPath,
    databaseId,
    nodePath,
    yesToClear,
    yesToNoWait,
    emulator,
    emulatorHost,
  };
}

function validateParams(commandParams: FirestoreClearParams): void {
  if (!commandParams.emulator) {
    if (!commandParams.accountCredentialsPath) {
      throw new Error(
        colors.bold(colors.red("Missing: ")) +
          colors.bold(params.accountCredentialsPath.key) +
          " - " +
          params.accountCredentialsPath.description
      );
    }
    if (!fs.existsSync(commandParams.accountCredentialsPath)) {
      throw new Error(
        colors.bold(colors.red("Account credentials file does not exist: ")) +
          colors.bold(commandParams.accountCredentialsPath)
      );
    }
  }
}

async function importFirestoreData(params: FirestoreClearParams) {
  let credentials: IFirebaseCredentials | undefined = undefined;
  if (!params.emulator) {
    console.log(`Getting Credentials from ${params.accountCredentialsPath}`);
    credentials = await getCredentialsFromFile(params.accountCredentialsPath);
  } else {
    console.log(`Using Firestore Emulator.`, params.emulatorHost);
    process.env["FIRESTORE_EMULATOR_HOST"] = params.emulatorHost;
  }
  console.log("Getting Firestore DB Reference");
  const db = getFirestoreDBReference(credentials, params.databaseId);
  console.log(`Getting DB Reference for database ${params.databaseId}`);
  const pathReference = getDBReferenceFromPath(db, params.nodePath);
  console.log(colors.bold("Reading data to import 📚"));

  const nodeLocation =
    (<
      | FirebaseFirestore.DocumentReference
      | FirebaseFirestore.CollectionReference
    >pathReference).path || "[database root]";
  const projectID =
    process.env.FIRESTORE_EMULATOR_HOST || (credentials as any).project_id;
  const deleteText = `About to clear all data from '${projectID}' firestore starting at '${nodeLocation}'.`;
  console.log(`\n\n${colors.bold(colors.blue(deleteText))}`);
  if (!params.yesToClear) {
    console.log(
      colors.bgYellow(
        colors.blue(
          " === Warning: This will clear all existing data. Do you want to proceed? === "
        )
      )
    );
    const response: { continue: boolean } = await prompt({
      type: "confirm",
      name: "continue",
      message: "Proceed with clear?",
    });
    if (!response.continue) {
      throw new ActionAbortedError("Clear Aborted");
    }
  } else if (!params.yesToNoWait) {
    console.log(
      colors.bgYellow(
        colors.blue(
          " === Warning: Deletion will start in 5 seconds. Hit Ctrl-C to cancel. === "
        )
      )
    );
    await sleep(5000);
  }
  console.log(colors.bold(colors.green("Starting clearing of records 🏋️")));
  await firestoreClear(pathReference, true);
  console.log(colors.bold(colors.green("All done 🎉")));
}

(async () => {
  const program = setupProgram();
  const commandParams = parseParams(program);
  validateParams(commandParams);
  await importFirestoreData(commandParams);
})().catch((error) => {
  if (error instanceof ActionAbortedError) {
    console.log(error.message);
  } else if (error instanceof Error) {
    console.error(colors.red(`${error.name}: ${error.message}`));
    console.error(colors.red(error.stack as string));
    process.exit(1);
  } else {
    console.log(colors.red(error));
  }
});
