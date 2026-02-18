const packageInfo = require('../../package.json');
import fs from 'fs';
const accountCredentialsEnvironmentKey = 'GOOGLE_APPLICATION_CREDENTIALS';
const defaultBackupPathname = 'firebase-export.json';
const defaultDatabaseId = '(default)';
const defaultFirestoreEmulatorHost = '127.0.0.1:8080';

const commandLineParams: { [param: string]: Params } =
  {
    accountCredentialsPath: {
      shortKey: 'a',
      key: 'accountCredentials',
      args: '<path>',
      description: `path to Google Cloud account credentials JSON file. If missing, will look at the ${accountCredentialsEnvironmentKey} environment variable for the path. Defaults to '${defaultBackupPathname}' if missing.`,
      defaultValue: defaultBackupPathname,
    },
    databaseId: {
      shortKey: 'd',
      key: 'databaseId',
      args: '<id>',
      description: `Firestore database ID. Defaults to '${defaultDatabaseId}' if missing.`,
    },
    backupPathImport: {
      shortKey: 'b',
      key: 'backupPath',
      args: '<path>',
      description: 'Path to the file or the folder with the backup data. Can be a file like e.g. backups/full-backup.json or a folder like backups/collections with multiple json\'s where each json will represent a collection.',
    },
    backupPathExport: {
      shortKey: 'b',
      key: 'backupPath',
      args: '<path>',
      description: 'Path to the file or the folder to store backup. Can be a file like e.g. backups/full-backup.json or a folder like backups/collections with multiple json\'s where each json will represent a collection.',
    },
    nodePath: {
      shortKey: 'n',
      key: 'nodePath',
      args: '<path>',
      description: `Path to database node (has to be a collection) where import will to start (e.g. collectionA/docB/collectionC). Imports at root level if missing.`,
    },    
    emulator: {
      shortKey: 'e',
      key: 'emulator',
      description: 'Use Firestore emulator instead of the production Firestore. When set, the emulatorHost parameter is required and the accountCredentialsPath is ignored.',
    },
    emulatorHost: {
      shortKey: 'h',
      key: 'emulatorHost',
      args: '<host>',
      description: `Firestore emulator host. Defaults to '${defaultFirestoreEmulatorHost}' if missing.`,
      defaultValue: defaultFirestoreEmulatorHost,
    },
    yesToImport: {
      shortKey: 'y',
      key: 'yes',
      description: 'Unattended import without confirmation (like hitting "y" from the command line).',
    },
    yesToClear: {
      shortKey: 'y',
      key: 'yes',
      description: 'Unattended clear without confirmation (like hitting "y" from the command line).',
    },
    yesToNoWait: {
      shortKey: 'w',
      key: 'noWait',
      description: 'Use with unattended confirmation to remove the 5 second delay.',
    },
    prettyPrint: {
      shortKey: 'p',
      key: 'prettyPrint',
      description: 'JSON backups done with pretty-printing.',
    },
    limit: {
      shortKey: 'l',
      key: 'limit',
      args: '<number>',
      description: 'Maximum documents to export per collection (cursor-based pagination). Omit for full export.',
    },
    startAfter: {
      shortKey: 's',
      key: 'startAfter',
      args: '<docId>',
      description: 'Document ID to start after (for resuming paginated exports).',
    },
    pages: {
      shortKey: 'g',
      key: 'pages',
      args: '<number>',
      description: 'Number of pages to fetch in one run (requires --limit). Each page uses the last document ID from the previous page as startAfter.',
    },
  };

const buildOption = ({shortKey, key, args = '', description}: Params): [string, string] => [`-${shortKey} --${key} ${args}`, description];

const isPathFolder = (path: string): boolean => fs.lstatSync(path).isDirectory();

const isPathFile = (path: string): boolean => fs.lstatSync(path).isFile();

/*
See https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
 */
class ActionAbortedError extends Error {
  constructor(m?: string) {
    super(m);
    Object.setPrototypeOf(this, ActionAbortedError.prototype);
  }
}

export {packageInfo, accountCredentialsEnvironmentKey, commandLineParams, buildOption, ActionAbortedError, isPathFolder, isPathFile};

interface Params {
  shortKey: string;
  key: string;
  args?: string;
  description: string;
  defaultValue?: string | boolean | string[];
}