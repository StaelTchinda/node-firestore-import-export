import {
  batchExecutor,
  isLikeDocument,
  isRootOfDatabase,
  safelyGetCollectionsSnapshot,
  safelyGetDocumentReferences,
} from './firestore-helpers';
import * as admin from 'firebase-admin';
import DocumentReference = FirebaseFirestore.DocumentReference;

export type ClearProgressCallback = (done: number) => void;

const clearData = async (
  startingRef: admin.firestore.Firestore |
    FirebaseFirestore.DocumentReference |
    FirebaseFirestore.CollectionReference,
  logs = false,
  onProgress?: ClearProgressCallback
) => {
  const progressState = { done: 0 };
  if (isLikeDocument(startingRef)) {
    const promises: Promise<any>[] = [
      clearCollections(startingRef, logs, onProgress, progressState),
    ];
    if (!isRootOfDatabase(startingRef)) {
      promises.push(startingRef.delete() as Promise<any>);
    }
    return Promise.all(promises);
  } else {
    return clearDocuments(
      <FirebaseFirestore.CollectionReference>startingRef,
      logs,
      onProgress,
      progressState
    );
  }
};

const clearCollections = async (
  startingRef: admin.firestore.Firestore | FirebaseFirestore.DocumentReference,
  logs = false,
  onProgress?: ClearProgressCallback,
  progressState?: { done: number }
) => {
  logs && console.log(`Cleaning collections from ${startingRef}`);
  const collectionPromises: Array<Promise<any>> = [];
  const collectionsSnapshot = await safelyGetCollectionsSnapshot(startingRef, logs);
  collectionsSnapshot.map((collectionRef: FirebaseFirestore.CollectionReference) => {
    collectionPromises.push(
      clearDocuments(collectionRef, logs, onProgress, progressState)
    );
  });
  return batchExecutor(collectionPromises);
};

const clearDocuments = async (
  collectionRef: FirebaseFirestore.CollectionReference,
  logs = false,
  onProgress?: ClearProgressCallback,
  progressState?: { done: number }
) => {
  logs && console.log(`Cleaning documents from ${collectionRef.path}`);
  const allDocuments = await safelyGetDocumentReferences(collectionRef, logs);
  const documentPromises: Array<Promise<any>> = [];
  allDocuments.forEach((docRef: DocumentReference) => {
    documentPromises.push(
      clearCollections(docRef, logs, onProgress, progressState)
        .then(() => docRef.delete())
        .then(() => {
          if (onProgress && progressState !== undefined) {
            progressState.done += 1;
            onProgress(progressState.done);
          }
        })
    );
  });
  return batchExecutor(documentPromises);
};

export default clearData;