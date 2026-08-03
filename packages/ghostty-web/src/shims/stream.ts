import {
  BrowserReadableStream,
  BrowserStream,
  BrowserWritableStream,
} from "../streams";

export class Stream extends BrowserStream {}
export class Readable extends BrowserReadableStream {
  constructor() {
    super(80, 24);
  }
}
export class Writable extends BrowserWritableStream {
  constructor() {
    super({ write: (_data, callback) => callback?.() }, 80, 24);
  }
}
export class PassThrough extends Writable {}
export default Stream;
