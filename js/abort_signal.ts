import { EventTarget } from "./event_target";
import * as domTypes from "./dom_types";
export class AbortSignal extends EventTarget implements domTypes.AbortSignal {
  private _aborted: boolean = false;
  get aborted(): boolean {
    return this._aborted;
  }
  private _onabort:
    | ((this: domTypes.AbortSignal, ev: domTypes.ProgressEvent) => any)
    | null = null;
  get onabort():
    | ((this: domTypes.AbortSignal, ev: domTypes.ProgressEvent) => any)
    | null {
    return this._onabort;
  }

  set onabort(
    func:
      | ((this: domTypes.AbortSignal, ev: domTypes.ProgressEvent) => any)
      | null
  ) {
    this._onabort = func;
  }
}
