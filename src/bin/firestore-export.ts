#!/usr/bin/env node
import { Command } from "commander";
import colors from "colors";
import process from "process";
import fs from "fs";
import { firestoreExport, ExportOptions } from "../lib";
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
  limit?: number;
  startAfter?: string;
  pages?: number;
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
    .option(...buildOption(params.limit))
    .option(...buildOption(params.startAfter))
    .option(...buildOption(params.pages))
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
  const limitOpt = options[params.limit.key];
  const limit = limitOpt != null && limitOpt !== "" ? parseInt(String(limitOpt), 10) : undefined;
  const startAfter = options[params.startAfter.key] || undefined;
  const pagesOpt = options[params.pages.key];
  const pages = pagesOpt != null && pagesOpt !== "" ? parseInt(String(pagesOpt), 10) : undefined;

  return {
    accountCredentialsPath,
    backupPath,
    databaseId,
    prettyPrint,
    nodePath,
    limit,
    startAfter,
    pages: pages != null && !isNaN(pages) ? pages : undefined,
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
  if (commandParams.limit != null && (commandParams.limit < 1 || isNaN(commandParams.limit))) {
    throw new Error(
      colors.bold(colors.red("Invalid: ")) +
        colors.bold(params.limit.key) +
        " - must be a positive number."
    );
  }
  if (commandParams.pages != null && (commandParams.pages < 1 || isNaN(commandParams.pages))) {
    throw new Error(
      colors.bold(colors.red("Invalid: ")) +
        colors.bold(params.pages.key) +
        " - must be a positive number."
    );
  }
  if (commandParams.pages != null && commandParams.pages > 1 && commandParams.limit == null) {
    throw new Error(
      colors.bold(colors.red("Invalid: ")) +
        colors.bold(params.pages.key) +
        " requires " +
        colors.bold(params.limit.key) +
        " to be set."
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

function getPaginatedBackupFilename(backupPath: string, startAfter?: string, pageNumber?: number): string {
  const lastDot = backupPath.lastIndexOf(".");
  const base = lastDot > 0 ? backupPath.slice(0, lastDot) : backupPath;
  const ext = lastDot > 0 ? backupPath.slice(lastDot) : ".json";
  if (pageNumber != null && pageNumber >= 1) {
    return `${base}-page${pageNumber}${ext}`;
  }
  if (startAfter) {
    const safeId = startAfter.replace(/[/\\?%*:|"<>]/g, "-");
    return `${base}-after-${safeId}${ext}`;
  }
  return `${base}-page1${ext}`;
}

function getMetadataFilename(backupPath: string): string {
  const lastDot = backupPath.lastIndexOf(".");
  const base = lastDot > 0 ? backupPath.slice(0, lastDot) : backupPath;
  return `${base}-metadata.json`;
}

function getCursorFromExportMetadata(exportMetadata: any): { lastDocumentId: string | null; hasMore: boolean } | null {
  if (!exportMetadata) return null;
  if (exportMetadata.collections) {
    const keys = Object.keys(exportMetadata.collections);
    if (keys.length === 0) return null;
    if (keys.length > 1) return null;
    const meta = exportMetadata.collections[keys[0]] as { lastDocumentId: string | null; hasMore: boolean };
    return { lastDocumentId: meta.lastDocumentId, hasMore: meta.hasMore };
  }
  return {
    lastDocumentId: exportMetadata.lastDocumentId ?? null,
    hasMore: Boolean(exportMetadata.hasMore),
  };
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
  const exportOptions: ExportOptions | undefined =
    params.limit != null
      ? {
          limit: params.limit,
          startAfter: params.startAfter,
        }
      : undefined;
  if (exportOptions) {
    console.log(colors.blue(`Pagination: limit=${params.limit}${params.startAfter ? `, startAfter=${params.startAfter}` : ""}${params.pages != null && params.pages > 1 ? `, pages=${params.pages}` : ""}`));
  }

  const pagesRequested = params.pages != null && params.pages > 1 ? params.pages : 1;
  const isMultiPage = isPathFile(params.backupPath) && exportOptions && pagesRequested > 1;

  if (isMultiPage) {
    let startAfter: string | undefined = params.startAfter;
    let pageNum = 1;
    let lastExportMetadata: any = null;
    while (pageNum <= pagesRequested) {
      console.log(colors.bold(colors.green(`Starting Export 🏋️ (page ${pageNum}/${pagesRequested})`)));
      const options: ExportOptions = { limit: params.limit!, startAfter };
      const rawResults = await firestoreExport(pathReference, true, options);
      const exportMetadata = rawResults.__export_metadata__;
      const results = exportMetadata
        ? (() => {
            const { __export_metadata__, ...rest } = rawResults;
            return rest;
          })()
        : rawResults;
      const cursor = getCursorFromExportMetadata(exportMetadata);
      if (pageNum === 1 && cursor === null && exportMetadata?.collections && Object.keys(exportMetadata.collections).length > 1) {
        console.log(colors.yellow("Multiple collections detected. --pages only writes one page; use --nodePath to target one collection for multi-page export."));
      }
      const outputPath = getPaginatedBackupFilename(params.backupPath, undefined, pageNum);
      const stringResults = JSON.stringify(results, undefined, params.prettyPrint ? 2 : undefined);
      await writeResults(stringResults, outputPath);
      console.log(colors.yellow(`Results were saved to ${outputPath}`));
      lastExportMetadata = exportMetadata;
      if (cursor == null || !cursor.hasMore) break;
      startAfter = cursor.lastDocumentId ?? undefined;
      if (!startAfter) break;
      pageNum++;
    }
    const metadataPath = getMetadataFilename(params.backupPath);
    const metadata = {
      limit: params.limit,
      startAfter: params.startAfter ?? null,
      pagesRequested,
      pagesWritten: pageNum,
      exportMetadata: lastExportMetadata,
      exportedAt: new Date().toISOString(),
      nodePath: params.nodePath || null,
    };
    await writeResults(JSON.stringify(metadata, undefined, params.prettyPrint ? 2 : undefined), metadataPath);
    console.log(colors.yellow(`Pagination metadata was saved to ${metadataPath}`));
    if (lastExportMetadata?.collections) {
      for (const [coll, meta] of Object.entries(lastExportMetadata.collections)) {
        const m = meta as { lastDocumentId: string | null; hasMore: boolean };
        if (m.hasMore && m.lastDocumentId) {
          console.log(colors.blue(`  Collection '${coll}': has more data. Resume with --startAfter ${m.lastDocumentId}`));
        }
      }
    } else if (lastExportMetadata && (lastExportMetadata as { hasMore?: boolean }).hasMore && (lastExportMetadata as { lastDocumentId?: string }).lastDocumentId) {
      console.log(colors.blue(`  Has more data. Resume with --startAfter ${(lastExportMetadata as { lastDocumentId: string }).lastDocumentId}`));
    }
    console.log(colors.bold(colors.green("All done 🎉")));
    return;
  }

  console.log(colors.bold(colors.green("Starting Export 🏋️")));
  const rawResults = await firestoreExport(pathReference, true, exportOptions);
  console.log("Export from Firestore completed");

  const exportMetadata = rawResults.__export_metadata__;
  const results = exportMetadata
    ? (() => {
        const { __export_metadata__, ...rest } = rawResults;
        return rest;
      })()
    : rawResults;

  const stringResults = JSON.stringify(
    results,
    undefined,
    params.prettyPrint ? 2 : undefined
  );

  console.log("Saving Results");
  if (isPathFile(params.backupPath)) {
    const outputPath = exportOptions
      ? getPaginatedBackupFilename(params.backupPath, params.startAfter)
      : params.backupPath;
    await writeResults(stringResults, outputPath);
    console.log(colors.yellow(`Results were saved to ${outputPath}`));
    if (exportMetadata) {
      const metadataPath = getMetadataFilename(params.backupPath);
      const metadata = {
        limit: params.limit,
        startAfter: params.startAfter ?? null,
        exportMetadata,
        exportedAt: new Date().toISOString(),
        nodePath: params.nodePath || null,
      };
      await writeResults(JSON.stringify(metadata, undefined, params.prettyPrint ? 2 : undefined), metadataPath);
      console.log(colors.yellow(`Pagination metadata was saved to ${metadataPath}`));
      if (exportMetadata.collections) {
        for (const [coll, meta] of Object.entries(exportMetadata.collections)) {
          const m = meta as { lastDocumentId: string | null; hasMore: boolean };
          if (m.hasMore && m.lastDocumentId) {
            console.log(colors.blue(`  Collection '${coll}': has more data. Resume with --startAfter ${m.lastDocumentId}`));
          }
        }
      } else if ((exportMetadata as { lastDocumentId?: string | null; hasMore?: boolean }).hasMore) {
        const m = exportMetadata as { lastDocumentId: string | null; hasMore: boolean };
        if (m.lastDocumentId) {
          console.log(colors.blue(`  Has more data. Resume with --startAfter ${m.lastDocumentId}`));
        }
      }
    }
    console.log(colors.bold(colors.green("All done 🎉")));
  } else if (isPathFolder(params.backupPath)) {
    const collections = results["__collections__"];
    if (!collections || Object.keys(collections).length === 0) {
      console.log(colors.bold(colors.red("No collections were found")));
      return;
    }
    const collectionNames = Object.keys(collections).filter((k) => k !== "__export_metadata__");
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
    if (exportMetadata) {
      const metadataPath = getMetadataFilename(params.backupPath + "/export");
      const metadata = {
        limit: params.limit,
        startAfter: params.startAfter ?? null,
        exportMetadata,
        exportedAt: new Date().toISOString(),
        nodePath: params.nodePath || null,
      };
      await writeResults(JSON.stringify(metadata, undefined, params.prettyPrint ? 2 : undefined), metadataPath);
      console.log(colors.yellow(`Pagination metadata was saved to ${metadataPath}`));
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
