import {deleteSync} from 'del';

(async () => {
  await deleteSync(['dist']);
})();