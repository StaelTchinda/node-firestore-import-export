import {
  batchExecutor,
  isLikeDocument,
  isRootOfDatabase,
  safelyGetCollectionsSnapshot,
  safelyGetDocumentReferences,
  safelyGetPaginatedDocuments,
} from './firestore-helpers';
import * as admin from 'firebase-admin';
import {serializeSpecialTypes} from './helpers';

export interface ExportOptions {
  limit?: number;
  startAfter?: string;
}

export interface ExportPaginationMetadata {
  lastDocumentId: string | null;
  hasMore: boolean;
}

export interface ExportResultWithMetadata {
  __export_metadata__?: ExportPaginationMetadata;
  [key: string]: any;
}

export type ExportProgressCallback = (done: number) => void;

const exportData = async (
  
  startingRef: admin.firestore.Firestore |
    FirebaseFirestore.DocumentReference |
    FirebaseFirestore.CollectionReference,
 
  logs = false,
  options?: ExportOptions,
  onProgress?: ExportProgressCallback
) => {
  const progressState = { done: 0 };
  if (isLikeDocument(startingRef)) {
    const collectionsPromise = getCollections(startingRef, logs, options, onProgress, progressState);
    let dataPromise: Promise<any>;
    if (isRootOfDatabase(startingRef)) {
      dataPromise = Promise.resolve({});
    } else {
      dataPromise = (<FirebaseFirestore.DocumentReference>startingRef).get()
        .then(snapshot => snapshot.data())
        .then(data => serializeSpecialTypes(data));
    }
    return await batchExecutor([collectionsPromise, dataPromise]).then(res => {
      const collectionsResult = res[0];
      const hasMeta = collectionsResult?.__collections_data__ != null && collectionsResult?.__export_metadata__ != null;
      const collections = hasMeta ? collectionsResult.__collections_data__ : collectionsResult;
      const out: any = { '__collections__': collections, ...res[1] };
      if (hasMeta) {
        out.__export_metadata__ = collectionsResult.__export_metadata__;
      }
      return out;
    });
  } else {
    return await getDocuments(
      <FirebaseFirestore.CollectionReference>startingRef,
      logs, 
      options,
      onProgress,
      progressState
    );
  }
};

const getCollections = async (
  startingRef: admin.firestore.Firestore | FirebaseFirestore.DocumentReference,
  logs = false,
  options?: ExportOptions
  onProgress?: ExportProgressCallback,
  progressState?: { done: number }
) => {
  const collectionRefs = await safelyGetCollectionsSnapshot(startingRef, logs);
  const collectionNames: Array<string> = [];
  const collectionPromises: Array<Promise<any>> = [];
  for (const collectionRef of collectionRefs) {
    collectionNames.push(collectionRef.id);
    const useStartAfter = options?.startAfter != null && collectionRefs.length === 1 ? options.startAfter : undefined;
    collectionPromises.push(getDocuments(collectionRef, logs, options?.limit != null ? { ...options, startAfter: useStartAfter } : undefined, onProgress, progressState));
  }
  const results = await batchExecutor(collectionPromises);
  const zipped: any = {};
  const metadataByCollection: Record<string, ExportPaginationMetadata> = {};
  results.forEach((res: any, idx: number) => {
    const name = collectionNames[idx];
    if (res && res.__export_metadata__) {
      metadataByCollection[name] = res.__export_metadata__;
      const { __export_metadata__, ...rest } = res;
      zipped[name] = rest;
    } else {
      zipped[name] = res;
    }
  });
  if (Object.keys(metadataByCollection).length > 0) {
    return { __collections_data__: zipped, __export_metadata__: { collections: metadataByCollection } };
  }
  return zipped;
};

const getDocuments = async (
  
  collectionRef: FirebaseFirestore.CollectionReference,
  logs = false,
  options?: ExportOptions
  onProgress?: ExportProgressCallback,
  progressState?: { done: number }
): Promise<ExportResultWithMetadata> => {
  logs && console.log(`Retrieving documents from ${collectionRef.path}`);
  const results: any = {};
  const usePagination = options?.limit != null && options.limit > 0;
  let documentRefs: FirebaseFirestore.DocumentReference[];
  let lastDocumentId: string | null = null;
  let hasMore = false;

  if (usePagination && options) {
    const limit = options.limit as number;
    const paginated = await safelyGetPaginatedDocuments(
      collectionRef,
      { limit, startAfterDocId: options.startAfter },
      logs
    );
    documentRefs = paginated.documentRefs;
    lastDocumentId = paginated.lastDocumentId;
    hasMore = paginated.hasMore;
  } else {
    documentRefs = await safelyGetDocumentReferences(collectionRef, logs);
  }

  const documentPromises: Array<Promise<object>> = [];
  const allDocuments = await safelyGetDocumentReferences(collectionRef, logs);
  allDocuments.forEach((doc) => {

    documentPromises.push(new Promise(async (resolve) => {
      const docSnapshot = await doc.get();
      const docDetails: any = {};
      if (docSnapshot.exists) {
        docDetails[docSnapshot.id] = serializeSpecialTypes(docSnapshot.data());
      } else {
        docDetails[docSnapshot.id] = {};
      }
      const subOptions = usePagination ? undefined : options;
      docDetails[docSnapshot.id]['__collections__'] = await getCollections(docSnapshot.ref, logs, subOptions, onProgress, progressState);
      resolve(docDetails);
    }));
  });
  (await batchExecutor(documentPromises))
    .forEach((res: any) => {
      Object.keys(res).map(key => (results[key] = res[key]));
    });

  if (usePagination) {
    results.__export_metadata__ = { lastDocumentId, hasMore };
  }
  return results;
};

export default exportData;