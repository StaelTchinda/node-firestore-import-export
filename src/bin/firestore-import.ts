#!/usr/bin/env node
import { Command } from "commander";
import { prompt } from "enquirer";
import colors from "colors";
import process from "process";
import fs from "fs";
import { firestoreImport } from "../lib";
import {
  getCredentialsFromFile,
  getDBReferenceFromPath,
  getFirestoreDBReference,
} from "../lib/firestore-helpers";
import { getJsonFromFile } from "../lib/helpers";
import {
  accountCredentialsEnvironmentKey,
  ActionAbortedError,
  buildOption,
  commandLineParams as params,
  packageInfo,
  isPathFile,
  isPathFolder,
} from "./bin-common";
import { IFirebaseCredentials } from "../interfaces/IFirebaseCredentials";

interface FirestoreImportParams {
  accountCredentialsPath: string;
  backupPath: string;
  databaseId: string;
  nodePath: string;
  yesToImport: boolean;

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
    .option(...buildOption(params.backupPathImport))
    .option(...buildOption(params.nodePath))
    .option(...buildOption(params.yesToImport))
    .option(...buildOption(params.databaseId))
    .option(...buildOption(params.emulator))
    .option(...buildOption(params.emulatorHost))
    .parse(process.argv);

  return program;
}

function parseParams(program: Command): FirestoreImportParams {
  const options = program.opts();

  const accountCredentialsPath =
    options[params.accountCredentialsPath.key] ||
    process.env[accountCredentialsEnvironmentKey];
  const backupPath = options[params.backupPathImport.key];
  const databaseId = options[params.databaseId.key];
  const nodePath = options[params.nodePath.key];
  const yesToImport = Boolean(options[params.yesToImport.key]);
  const emulator = Boolean(options[params.emulator.key]);
  const emulatorHost = options[params.emulatorHost.key] || params.emulatorHost.defaultValue;

  return {
    accountCredentialsPath,
    backupPath,
    databaseId,
    nodePath,
    yesToImport,
    emulator,
    emulatorHost,
  };
}

function validateParams(commandParams: FirestoreImportParams): void {
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

  if (!commandParams.backupPath) {
    throw new Error(
      colors.bold(colors.red("Missing: ")) +
        colors.bold(params.backupPathExport.key) +
        " - " +
        params.backupPathExport.description
    );
  }
}

async function readData(path: string): Promise<any> {
  let data: any;
  if (isPathFile(path)) {
    if (!path.endsWith(".json")) {
      throw new Error("Backup file has to be a json file.");
    }
    data = await getJsonFromFile(path);
  } else if (isPathFolder(path)) {
    const files = fs
      .readdirSync(path)
      .filter((file) => file.endsWith(".json"));
    data = { __collections__: {} };
    for (const file of files) {
      const collectionData = await getJsonFromFile<Record<string, any>>(
        `${path}/${file}`
      );
      for (const key in collectionData) {
        data["__collections__"][key] = collectionData[key];
      }
    }
  } else {
    throw new Error("Backup path has to be a file or a folder.");
  }
  return data;
}

async function importFirestoreData(params: FirestoreImportParams) {
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
  const data = await readData(params.backupPath);

  if (!params.yesToImport) {
    const nodeLocation =
      (<
        | FirebaseFirestore.DocumentReference
        | FirebaseFirestore.CollectionReference
      >pathReference).path || "[database root]";
    const importText = `About to import data '${params.backupPath}' to the firestore database with ID '${params.databaseId}' starting at '${nodeLocation}'.`;

    console.log(`\n\n${colors.bold(colors.blue(importText))}`);
    console.log(
      colors.bgYellow(
        colors.blue(
          " === Warning: This will overwrite existing data. Do you want to proceed? === "
        )
      )
    );

    const response: { continue: boolean } = await prompt({
      type: "confirm",
      name: "continue",
      message: "Proceed with import?",
    });
    if (!response.continue) {
      throw new ActionAbortedError("Import Aborted");
    }
  }

  console.log(colors.bold(colors.green("Starting Import 🏋️")));
  await firestoreImport(data, pathReference, true, true);
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
    console.error(colors.red(error));
  }
});
