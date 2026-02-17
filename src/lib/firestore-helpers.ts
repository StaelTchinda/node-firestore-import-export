import * as admin from 'firebase-admin';
import {IFirebaseCredentials} from '../interfaces/IFirebaseCredentials';
import { FirebaseFirestoreError, getFirestore } from 'firebase-admin/firestore';
import { getJsonFromFile } from './helpers';

const SLEEP_TIME = 1000;
const DEFAULT_PARALLEL_PROMISES_COUNT = 25;

const getCredentialsFromFile = async (credentialsFilename: string): Promise<IFirebaseCredentials> => {
  return getJsonFromFile<IFirebaseCredentials>(credentialsFilename);
};

const getFirestoreDBReference = (credentials?: IFirebaseCredentials, databaseId?: string): admin.firestore.Firestore => {
  if (credentials) {
    admin.initializeApp({
      credential: admin.credential.cert(credentials as any),
      databaseURL: `https://${credentials.project_id}.firebaseio.com`,
    });
  } else {
    admin.initializeApp();
  }
  if (databaseId) {
    return getFirestore(admin.app(), databaseId);
  } else {
    return admin.firestore();
  }
};

const getDBReferenceFromPath = (db: admin.firestore.Firestore, dataPath?: string): admin.firestore.Firestore |
  FirebaseFirestore.DocumentReference |
  FirebaseFirestore.CollectionReference => {
  let startingRef;
  if (dataPath) {
    const parts = dataPath.split('/').length;
    const isDoc = parts % 2 === 0;
    startingRef = isDoc ? db.doc(dataPath) : db.collection(dataPath);
  } else {
    startingRef = db;
  }
  return startingRef;
};

const isLikeDocument = (ref: admin.firestore.Firestore |
  FirebaseFirestore.DocumentReference |
  FirebaseFirestore.CollectionReference): ref is FirebaseFirestore.DocumentReference => {
  return (<FirebaseFirestore.DocumentReference>ref).collection !== undefined;
};

const isRootOfDatabase = (ref: admin.firestore.Firestore |
  FirebaseFirestore.DocumentReference |
  FirebaseFirestore.CollectionReference): ref is admin.firestore.Firestore => {
  return (<admin.firestore.Firestore>ref).batch !== undefined;
};

const sleep = (timeInMS: number): Promise<void> => new Promise(resolve => setTimeout(resolve, timeInMS));

const batchExecutor = async function <T>(promises: Promise<T>[], batchSize: number = DEFAULT_PARALLEL_PROMISES_COUNT): Promise<T[]> {
  const res: T[] = [];
  while (promises.length > 0) {
    const temp = await Promise.all(promises.splice(0, batchSize));
    res.push(...temp);
  }
  return res;
};

const safelyGetCollectionsSnapshot = async (startingRef: admin.firestore.Firestore | FirebaseFirestore.DocumentReference, logs = false): Promise<FirebaseFirestore.CollectionReference[]> => {
  let collectionsSnapshot, deadlineError = false;
  do {
    try {
      collectionsSnapshot = await startingRef.listCollections();
      deadlineError = false;
    } catch (_e: any) {
      const e = _e as Error;
      if (e.message === 'Deadline Exceeded') {
        logs && console.log(`Deadline Error in getCollections()...waiting ${SLEEP_TIME / 1000} second(s) before retrying`);
        await sleep(SLEEP_TIME);
        deadlineError = true;
      } else {
        throw e;
      }
    }
  } while (deadlineError || !collectionsSnapshot);
  return collectionsSnapshot;
};

const safelyGetDocumentReferences = async (collectionRef: FirebaseFirestore.CollectionReference, logs = false): Promise<FirebaseFirestore.DocumentReference[]> => {
  let allDocuments, deadlineError = false;
  do {
    try {
      allDocuments = await collectionRef.listDocuments();
      deadlineError = false;
    } catch (_e: any) {
      const e = _e as FirebaseFirestoreError;
      if (e.code && e.code === '4') {
        logs && console.log(`Deadline Error in getDocuments()...waiting ${SLEEP_TIME / 1000} second(s) before retrying`);
        await sleep(SLEEP_TIME);
        deadlineError = true;
      } else {
        throw e;
      }
    }
  } while (deadlineError || !allDocuments);
  return allDocuments;
};

export interface PaginatedDocumentsResult {
  documentRefs: FirebaseFirestore.DocumentReference[];
  lastDocumentId: string | null;
  hasMore: boolean;
}

const safelyGetPaginatedDocuments = async (
  collectionRef: FirebaseFirestore.CollectionReference,
  options: { limit: number; startAfterDocId?: string },
  logs = false
): Promise<PaginatedDocumentsResult> => {
  const { limit, startAfterDocId } = options;
  const FieldPath = admin.firestore.FieldPath;
  let query: FirebaseFirestore.Query = collectionRef.orderBy(FieldPath.documentId()).limit(limit);
  if (startAfterDocId) {
    let startAfterSnapshot: FirebaseFirestore.DocumentSnapshot | undefined;
    let deadlineError = false;
    do {
      try {
        startAfterSnapshot = await collectionRef.doc(startAfterDocId).get();
        deadlineError = false;
      } catch (_e: any) {
        const e = _e as FirebaseFirestoreError;
        if (e.code && e.code === '4') {
          logs && console.log(`Deadline Error in getPaginatedDocuments()...waiting ${SLEEP_TIME / 1000} second(s) before retrying`);
          await sleep(SLEEP_TIME);
          deadlineError = true;
        } else {
          throw e;
        }
      }
    } while (deadlineError);
    if (startAfterSnapshot?.exists) {
      query = query.startAfter(startAfterSnapshot);
    }
  }
  let snapshot, deadlineError = false;
  do {
    try {
      snapshot = await query.get();
      deadlineError = false;
    } catch (_e: any) {
      const e = _e as FirebaseFirestoreError;
      if (e.code && e.code === '4') {
        logs && console.log(`Deadline Error in getPaginatedDocuments()...waiting ${SLEEP_TIME / 1000} second(s) before retrying`);
        await sleep(SLEEP_TIME);
        deadlineError = true;
      } else {
        throw e;
      }
    }
  } while (deadlineError || !snapshot);
  const docs = snapshot.docs;
  const documentRefs = docs.map((d) => d.ref);
  const lastDoc = docs.length > 0 ? docs[docs.length - 1] : null;
  const lastDocumentId = lastDoc ? lastDoc.id : null;
  const hasMore = docs.length === limit;
  return { documentRefs, lastDocumentId, hasMore };
};

type anyFirebaseRef = admin.firestore.Firestore |
  FirebaseFirestore.DocumentReference |
  FirebaseFirestore.CollectionReference

export {
  getCredentialsFromFile,
  getJsonFromFile,
  getFirestoreDBReference,
  getDBReferenceFromPath,
  isLikeDocument,
  isRootOfDatabase,
  sleep,
  batchExecutor,
  anyFirebaseRef,
  safelyGetCollectionsSnapshot,
  safelyGetDocumentReferences,
  safelyGetPaginatedDocuments,
};
