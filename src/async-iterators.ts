import { instanceOfAny, Func } from './util.js';
import { replaceTraps, reverseTransformCache, unwrap } from './wrap-idb-value.js';
import { IDBPObjectStore, IDBPIndex, IDBPCursor } from './entry.js';

const advanceMethodProps = ['continue', 'continuePrimaryKey', 'advance'];
const methodMap: { [s: string]: Func } = {};
const advanceResults = new WeakMap<IDBPCursor<any, any, any, any, any>, Promise<IDBPCursor<any, any, any, any ,any> | null>>();
const ittrProxiedCursorToOriginalProxy = new WeakMap<IDBPCursor<any, any, any, any ,any>, IDBPCursor<any, any, any, any ,any>>();

const cursorIteratorTraps: ProxyHandler<any> = {
  get(target, prop) {
    if (!advanceMethodProps.includes(prop as string)) return target[prop];

    let cachedFunc = methodMap[prop as string];

    if (!cachedFunc) {
      cachedFunc = methodMap[prop as string] = function (
        this: IDBPCursor<any, any, any, any ,any>,
        ...args: any
      ) {
        advanceResults.set(
          this,
          (ittrProxiedCursorToOriginalProxy.get(this) as any)[prop](...args),
        );
      };
    }

    return cachedFunc;
  },
};

async function* iterate(
  this: IDBPObjectStore<any> | IDBPIndex<any> | IDBPCursor<any, any, any, any ,any>,
  ...args: any[]
): AsyncIterableIterator<any> {
  // tslint:disable-next-line:no-this-assignment
  let cursor: typeof this | null = this;

  if (!(cursor instanceof IDBCursor)) {
    cursor = await (cursor as IDBPObjectStore<any> | IDBPIndex<any>).openCursor(...args);
  }

  if (!cursor) return;

  cursor = cursor as IDBPCursor<any, any, any, any ,any>;
  const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
  ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
  // Map this double-proxy back to the original, so other cursor methods work.
  reverseTransformCache.set(proxiedCursor, unwrap(cursor));

  while (cursor) {
    yield proxiedCursor;
    // If one of the advancing methods was not called, call continue().
    cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
    advanceResults.delete(proxiedCursor);
  }
}

function isIteratorProp(target: any, prop: number | string | symbol) {
  return (
    (prop === Symbol.asyncIterator &&
      instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor])) ||
    (prop === 'iterate' && instanceOfAny(target, [IDBIndex, IDBObjectStore]))
  );
}

replaceTraps((oldTraps) => ({
  ...oldTraps,
  get(target, prop, receiver) {
    if (isIteratorProp(target, prop)) return iterate;
    return oldTraps.get!(target, prop, receiver);
  },
  has(target, prop) {
    return isIteratorProp(target, prop) || oldTraps.has!(target, prop);
  },
}));
