#!/usr/bin/env node
import { Command } from "commander";
import colors from "colors";
import process from "process";
import fs from "fs";
import { Presets, SingleBar } from "cli-progress";
import { firestoreExport } from "../lib";
import {
  getCredentialsFromFile,
  getDBReferenceFromPath,
  getFirestoreDBReference,
} from "../lib/firestore-helpers";
import {
  accountCredentialsEnvironmentKey,
  buildOption,
  commandLineParams as params,
  packageInfo,
  isPathFile,
  isPathFolder,
} from "./bin-common";
import { IFirebaseCredentials } from "../interfaces/IFirebaseCredentials";

interface FirestoreExportParams {
  accountCredentialsPath: string;
  backupPath: string;
  databaseId: string;
  prettyPrint: boolean;
  nodePath: string;

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
    .option(...buildOption(params.backupPathExport))
    .option(...buildOption(params.nodePath))
    .option(...buildOption(params.prettyPrint))
    .option(...buildOption(params.databaseId))
    .option(...buildOption(params.emulator))
    .option(...buildOption(params.emulatorHost))
    .parse(process.argv);

  return program;
}

function parseParams(program: Command): FirestoreExportParams {
  const options = program.opts();

  const accountCredentialsPath =
    options[params.accountCredentialsPath.key] ||
    process.env[accountCredentialsEnvironmentKey];

  const backupPath = options[params.backupPathExport.key];

  const databaseId =
    options[params.databaseId.key] || params.databaseId.defaultValue;
  const prettyPrint = Boolean(options[params.prettyPrint.key]);
  const nodePath = options[params.nodePath.key] || "";
  const emulator = Boolean(options[params.emulator.key]);
  const emulatorHost =
    options[params.emulatorHost.key] || params.emulatorHost.defaultValue;


  return {
    accountCredentialsPath,
    backupPath,
    databaseId,
    prettyPrint,
    nodePath,
    emulator,
    emulatorHost,
  };
}

function validateParams(commandParams: FirestoreExportParams): void {
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

function writeResults(results: string, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.writeFile(filename, results, "utf8", (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(filename);
      }
    });
  });
}

async function exportFirestoreData(params: FirestoreExportParams) {
  let credentials: IFirebaseCredentials | undefined = undefined;
  if (!params.emulator) {
    console.log(`Getting Credentials from ${params.accountCredentialsPath}`);
    credentials = await getCredentialsFromFile(params.accountCredentialsPath);
  } else {
    console.log(`Using Firestore Emulator.`);
    process.env["FIRESTORE_EMULATOR_HOST"] = params.emulatorHost;
  }
  console.log("Getting Firestore DB Reference");
  const db = getFirestoreDBReference(credentials, params.databaseId);
  console.log(`Getting DB Reference for database ${params.databaseId}`);
  const pathReference = getDBReferenceFromPath(db, params.nodePath);
  console.log(colors.bold(colors.green("Starting Export 🏋️")));
  const bar = new SingleBar(
    {
      format: "Export | {value} documents | Elapsed: {duration_formatted}",
      hideCursor: true,
      clearOnComplete: true,
    },
    Presets.shades_classic
  );
  bar.start(0, 0);
  const onProgress = (done: number) => bar.update(done);
  const results = await firestoreExport(pathReference, true, onProgress);
  bar.stop();
  console.log("Export from Firestore completed");
  const stringResults = JSON.stringify(
    results,
    undefined,
    params.prettyPrint ? 2 : undefined
  );

  console.log("Saving Results");
  if (isPathFile(params.backupPath)) {
    await writeResults(stringResults, params.backupPath);
    console.log(colors.yellow(`Results were saved to ${params.backupPath}`));
    console.log(colors.bold(colors.green("All done 🎉")));
  } else if (isPathFolder(params.backupPath)) {
    const collections = results["__collections__"];
    if (!collections || Object.keys(collections).length === 0) {
      console.log(colors.bold(colors.red("No collections were found")));
      return;
    }
    const collectionNames = Object.keys(collections);
    for (const collectionName of collectionNames) {
      const collectionBackupFile = `${params.backupPath}/${collectionName}.json`;
      const collectionResults = {
        [collectionName]: collections[collectionName],
      };
      const collectionStringResults = JSON.stringify(
        collectionResults,
        undefined,
        params.prettyPrint ? 2 : undefined
      );
      await writeResults(collectionStringResults, collectionBackupFile);
      console.log(
        colors.yellow(
          `Collection ${collectionName} was saved to ${collectionBackupFile}`
        )
      );
    }
  } else {
    throw new Error(
      colors.bold(colors.red("Backup file is not a file or a folder: ")) +
        colors.bold(params.backupPath)
    );
  }
}

const program = setupProgram();

(async () => {
  const firestoreParams: FirestoreExportParams = parseParams(program);
  validateParams(firestoreParams);
  await exportFirestoreData(firestoreParams);
})().catch((error) => {
  if (error instanceof Error) {
    console.error(colors.red(error.message));
  } else {
    console.error(colors.red(error));
  }
  program.help();
  process.exit(1);
});
