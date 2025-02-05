import {deleteAsync} from 'del';

(async () => {
  await deleteAsync(['dist']);
})();