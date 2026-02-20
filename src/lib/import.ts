import {
  anyFirebaseRef,
  batchExecutor,
  isLikeDocument,
  isRootOfDatabase,
} from "./firestore-helpers";
import { array_chunks, unserializeSpecialTypes } from "./helpers";
import { ICollection } from "../interfaces/ICollection";

const DEFAULT_FIRESTORE_BATCH_SIZE: number = 300;

export type ImportProgressCallback = (done: number, total: number) => void;

function countDocumentsInCollection(data: ICollection): number {
  if ("__collections__" in data) {
    throw new Error(
      'countDocumentsInCollection expects collection data without top-level "__collections__"'
    );
  }
  let count = 0;
  for (const documentKey of Object.keys(data)) {
    count += 1;
    const doc = data[documentKey];
    if (doc && typeof doc === "object" && doc.hasOwnProperty("__collections__")) {
      const sub = doc["__collections__"] as Record<string, ICollection>;
      for (const collName of Object.keys(sub)) {
        count += countDocumentsInCollection(sub[collName]);
      }
    }
  }
  return count;
}

function countDocumentsInData(data: any): number {
  const dataToImport = { ...data };
  if (!dataToImport.hasOwnProperty("__collections__")) {
    return countDocumentsInCollection(dataToImport as ICollection);
  }
  const collections = dataToImport["__collections__"] as Record<string, ICollection>;
  let total = 0;
  for (const collection of Object.keys(collections)) {
    total += countDocumentsInCollection(collections[collection]);
  }
  return total;
}

const importData = (
  data: any,
  startingRef: anyFirebaseRef,
  mergeWithExisting: boolean = true,
  logs = false,
  onProgress?: ImportProgressCallback
): Promise<any> => {
  const dataToImport = { ...data };
  const total = onProgress ? countDocumentsInData(dataToImport) : 0;
  const progressState = { done: 0 };

  if (isLikeDocument(startingRef)) {
    if (!dataToImport.hasOwnProperty("__collections__")) {
      throw new Error(
        "Root or document reference doesn't contain a __collections__ property."
      );
    }
    const collections = dataToImport["__collections__"];
    const collectionPromises: Array<Promise<any>> = [];
    for (const collection in collections) {
      if (collections.hasOwnProperty(collection)) {
        collectionPromises.push(
          setDocuments(
            collections[collection],
            startingRef.collection(collection),
            mergeWithExisting,
            logs,
            onProgress,
            progressState,
            total
          )
        );
      }
    }
    if (isRootOfDatabase(startingRef)) {
      return batchExecutor(collectionPromises);
    } else {
      const documentID = startingRef.id;
      const documentData: any = {};
      documentData[documentID] = dataToImport;
      const documentPromise = setDocuments(
        documentData,
        startingRef.parent,
        mergeWithExisting,
        logs,
        onProgress,
        progressState,
        total
      );
      return documentPromise.then(() => batchExecutor(collectionPromises));
    }
  } else {
    return setDocuments(
      dataToImport,
      <FirebaseFirestore.CollectionReference>startingRef,
      mergeWithExisting,
      logs,
      onProgress,
      progressState,
      total
    );
  }
};

const setDocuments = (
  data: ICollection,
  startingRef: FirebaseFirestore.CollectionReference,
  mergeWithExisting: boolean = true,
  logs = false,
  onProgress?: ImportProgressCallback,
  progressState?: { done: number },
  total?: number
): Promise<any> => {
  logs && console.log(`Writing documents for ${startingRef.path}`);
  if ("__collections__" in data) {
    throw new Error(
      'Found unexpected "__collections__" in collection data. Does the starting node match' +
        " the root of the incoming data?"
    );
  }
  const collections: Array<any> = [];
  const chunks = array_chunks(Object.keys(data), DEFAULT_FIRESTORE_BATCH_SIZE);
  const chunkPromises = chunks.map((documentKeys: string[], index: number) => {
    logs && console.log(`Chunk ${index + 1}/${chunks.length}[${startingRef.path}]: Writing chunk ${index + 1} of ${chunks.length} for ${startingRef.path}`);
    const batch = startingRef.firestore.batch();
    logs && console.log(`Chunk ${index + 1}/${chunks.length}[${startingRef.path}]: preparing to write ${documentKeys.length} documents`);
    documentKeys.map((documentKey: string) => {
      if (data[documentKey]["__collections__"]) {
        Object.keys(data[documentKey]["__collections__"]).map((collection) => {
          collections.push({
            path: startingRef.doc(documentKey).collection(collection),
            collection: data[documentKey]["__collections__"][collection],
          });
        });
      }
      const { __collections__, ...documents } = data[documentKey];
      const documentData: any = unserializeSpecialTypes(documents);
      batch.set(startingRef.doc(documentKey), documentData, {
        merge: mergeWithExisting,
      });
    });
    logs && console.log(`Chunk ${index + 1}/${chunks.length}[${startingRef.path}]: Committing batch`);
    return batch.commit().then((results) => {
      if (onProgress && progressState !== undefined && total !== undefined) {
        progressState.done += documentKeys.length;
        onProgress(progressState.done, total);
      }
      logs && console.log(`Chunk ${index + 1}/${chunks.length}[${startingRef.path}]: Batch committed`);
      return results;
    });
  });
  return batchExecutor(chunkPromises)
    .then(() => {
      return collections.map((col) => {
        logs && console.log(`Writing subcollection for ${col.path}`);
        return setDocuments(
          col.collection,
          col.path,
          mergeWithExisting,
          logs,
          onProgress,
          progressState,
          total
        );
      });
    })
    .then((subCollectionPromises) => batchExecutor(subCollectionPromises))
    .catch((err) => {
      logs && console.error(err);
    })
    .finally(() => {
      logs && console.log(`Finished writing documents for ${startingRef.path}`);
    });
};

export default importData;
export { setDocuments };
