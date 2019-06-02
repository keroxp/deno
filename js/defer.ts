import * as domTypes from "./dom_types"
export function defer<T = void, E = any>(): domTypes.Defer<T, E> {
  let res: (v: T) => void;
  let rej: (e: E) => void;
  const promise = new Promise<T>((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  const src = { 
    resolve: (v: T) => {
      res(v);
      src[domTypes.PromiseState] = "resolved"
    },
    reject: (e: E) => {
      rej(e);
      src[domTypes.PromiseState] = "rejected";
    }, 
    [domTypes.PromiseState]: "pending" 
  };
  return Object.assign(promise, src);
}

export function rejectDefer<T,E>(e:E): domTypes.Defer<T> {
  return Object.assign(Promise.reject(e), {
    resolve: () => {},
    reject: () => {},
    [domTypes.PromiseState]: "rejected" as "rejected"
  });
}

export function resolveDefer<T>(e:T): domTypes.Defer<T> {
  return Object.assign(Promise.resolve(e), {
    resolve: () => {},
    reject: () => {},
    [domTypes.PromiseState]: "resolved" as "resolved"
  });
}
