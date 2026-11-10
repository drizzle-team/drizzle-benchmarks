// Minimal keep-alive HTTP/1.1 GET client on raw TCP sockets.
// One Conn == one socket == one in-flight request (like a k6 VU).
// Bodies are never buffered — only counted — so memory stays flat.
import type { Socket, SocketHandler } from 'bun';

export const ERR_NONE = 0;
export const ERR_TIMEOUT = 1;
export const ERR_CONNECT = 2;
export const ERR_CLOSED = 3; // server closed mid-response
export const ERR_PARSE = 4;

const CRLFCRLF = Buffer.from('\r\n\r\n');
const RE_CL = /\r\ncontent-length:[ \t]*(\d+)/;
const RE_CHUNKED = /\r\ntransfer-encoding:[^\r]*chunked/;
const RE_CLOSE = /\r\nconnection:[ \t]*close/;
const RE_KEEPALIVE = /\r\nconnection:[ \t]*keep-alive/;
const MAX_HEADER = 64 * 1024;

const P_IDLE = 0;
const P_HEAD = 1;
const P_LEN = 2;
const P_CHUNKED = 3;
const P_UNTIL_CLOSE = 4;

// chunked sub-states
const C_SIZE = 0;
const C_EXT = 1;
const C_SIZE_LF = 2;
const C_DATA = 3;
const C_DATA_CR = 4;
const C_DATA_LF = 5;
const C_TRAILER_START = 6;
const C_TRAILER_LINE = 7;
const C_END_LF = 8;

export interface Target {
  hostname: string;
  port: number;
  tls: boolean;
  hostHeader: string;
}

export function parseTarget(url: string): Target {
  const u = new URL(url);
  const tls = u.protocol === 'https:';
  const port = u.port ? Number(u.port) : tls ? 443 : 80;
  return { hostname: u.hostname.replace(/^\[|\]$/g, ''), port, tls, hostHeader: u.host };
}

const handlers: SocketHandler<Conn> = {
  data(sock, chunk) {
    sock.data.onData(chunk as unknown as Buffer);
  },
  drain(sock) {
    sock.data.onDrain();
  },
  end(sock) {
    sock.data.onClose(sock);
  },
  close(sock) {
    sock.data.onClose(sock);
  },
  error(sock) {
    sock.data.onClose(sock);
  },
};

export class Conn {
  sock: Socket<Conn> | null = null;

  // per-request outputs (read by caller after the promise resolves)
  status = 0;
  bytes = 0;
  t0 = 0; // request write time (performance.now)
  tFirst = 0; // first response byte
  tEnd = 0;
  deadline = 0; // checked by the worker's timeout sweeper
  /** responses completed on the current socket */
  served = 0;
  /** whether the current request went out on a socket that had already served a response */
  reused = false;

  private phase = P_IDLE;
  private hdr: Buffer | null = null;
  private remaining = 0;
  private cState = C_SIZE;
  private cSize = 0;
  private keepAlive = true;
  private pending: string | null = null;
  private done: ((err: number) => void) | null = null;

  constructor(private readonly target: Target) {}

  get alive() {
    return this.sock !== null;
  }

  async connect(): Promise<boolean> {
    try {
      this.sock = await Bun.connect<Conn>({
        hostname: this.target.hostname,
        port: this.target.port,
        tls: this.target.tls,
        data: this,
        socket: handlers,
      });
      this.served = 0;
      this.sock.setNoDelay?.(true);
      return true;
    } catch {
      this.sock = null;
      return false;
    }
  }

  request(path: string, timeoutMs: number): Promise<number> {
    this.phase = P_HEAD;
    this.status = 0;
    this.bytes = 0;
    this.hdr = null;
    this.keepAlive = true;
    this.tFirst = 0;
    this.reused = this.served > 0;
    return new Promise<number>((resolve) => {
      this.done = resolve;
      const req = 'GET ' + path + ' HTTP/1.1\r\nHost: ' + this.target.hostHeader + '\r\n\r\n';
      this.t0 = performance.now();
      this.deadline = this.t0 + timeoutMs;
      const w = this.sock!.write(req);
      if (w < req.length) this.pending = req.slice(Math.max(0, w));
    });
  }

  onDrain() {
    if (!this.pending || !this.sock) return;
    const p = this.pending;
    const w = this.sock.write(p);
    this.pending = w < p.length ? p.slice(Math.max(0, w)) : null;
  }

  onClose(sock: Socket<Conn>) {
    if (this.sock !== sock) return;
    this.sock = null;
    if (this.done) this.finish(this.phase === P_UNTIL_CLOSE ? ERR_NONE : ERR_CLOSED);
  }

  /** Called by the sweeper when deadline passed. */
  abort(err: number) {
    if (!this.done) return;
    this.finish(err);
    this.close();
  }

  close() {
    const s = this.sock;
    this.sock = null;
    s?.terminate();
  }

  private finish(err: number) {
    this.tEnd = performance.now();
    this.phase = P_IDLE;
    this.deadline = 0;
    this.pending = null;
    this.hdr = null;
    const d = this.done!;
    this.done = null;
    if (err === ERR_NONE) this.served++;
    if (err === ERR_NONE && !this.keepAlive) this.close();
    d(err);
  }

  onData(chunk: Buffer) {
    if (!this.done) return; // unsolicited bytes; ignore
    if (this.tFirst === 0) this.tFirst = performance.now();
    let buf = chunk;
    let i = 0;
    const phase = this.phase;

    if (phase === P_HEAD) {
      if (this.hdr) buf = Buffer.concat([this.hdr, chunk]);
      const end = buf.indexOf(CRLFCRLF);
      if (end < 0) {
        if (buf.length > MAX_HEADER) return this.abort(ERR_PARSE);
        this.hdr = buf === chunk ? Buffer.from(chunk) : buf; // copy: Bun may reuse chunk memory
        return;
      }
      this.hdr = null;
      // "HTTP/1.1 200 ..."
      const s = (buf[9]! - 48) * 100 + (buf[10]! - 48) * 10 + (buf[11]! - 48);
      if (!(s >= 100 && s <= 999)) return this.abort(ERR_PARSE);
      const head = buf.toString('latin1', 0, end).toLowerCase();
      i = end + 4;
      if (s >= 100 && s < 200) {
        // informational — skip and wait for the real response
        this.phase = P_HEAD;
        if (i < buf.length) this.onDataRest(buf.subarray(i));
        return;
      }
      this.status = s;
      const http10 = head.charCodeAt(7) === 48; // HTTP/1.0
      this.keepAlive = http10 ? RE_KEEPALIVE.test(head) : !RE_CLOSE.test(head);
      if (s === 204 || s === 304) {
        return this.finish(ERR_NONE);
      } else if (RE_CHUNKED.test(head)) {
        this.phase = P_CHUNKED;
        this.cState = C_SIZE;
        this.cSize = 0;
      } else {
        const m = RE_CL.exec(head);
        if (m) {
          this.phase = P_LEN;
          this.remaining = Number(m[1]);
          if (this.remaining === 0) return this.finish(ERR_NONE);
        } else {
          this.phase = P_UNTIL_CLOSE;
          this.keepAlive = false;
        }
      }
    }
    if (i < buf.length) this.body(buf, i);
  }

  private onDataRest(b: Buffer) {
    this.onData(b);
  }

  private body(buf: Buffer, i: number) {
    const n = buf.length;
    if (this.phase === P_LEN) {
      const take = Math.min(this.remaining, n - i);
      this.remaining -= take;
      this.bytes += take;
      if (this.remaining === 0) this.finish(ERR_NONE);
      return;
    }
    if (this.phase === P_UNTIL_CLOSE) {
      this.bytes += n - i;
      return;
    }
    // chunked
    while (i < n) {
      switch (this.cState) {
        case C_SIZE: {
          const c = buf[i++]!;
          if (c >= 48 && c <= 57) this.cSize = this.cSize * 16 + (c - 48);
          else if (c >= 97 && c <= 102) this.cSize = this.cSize * 16 + (c - 87);
          else if (c >= 65 && c <= 70) this.cSize = this.cSize * 16 + (c - 55);
          else if (c === 13) this.cState = C_SIZE_LF;
          else if (c === 59 || c === 32 || c === 9) this.cState = C_EXT;
          else return this.abort(ERR_PARSE);
          break;
        }
        case C_EXT:
          if (buf[i++] === 13) this.cState = C_SIZE_LF;
          break;
        case C_SIZE_LF:
          if (buf[i++] !== 10) return this.abort(ERR_PARSE);
          if (this.cSize === 0) this.cState = C_TRAILER_START;
          else {
            this.remaining = this.cSize;
            this.cState = C_DATA;
          }
          break;
        case C_DATA: {
          const take = Math.min(this.remaining, n - i);
          this.remaining -= take;
          this.bytes += take;
          i += take;
          if (this.remaining === 0) this.cState = C_DATA_CR;
          break;
        }
        case C_DATA_CR:
          if (buf[i++] !== 13) return this.abort(ERR_PARSE);
          this.cState = C_DATA_LF;
          break;
        case C_DATA_LF:
          if (buf[i++] !== 10) return this.abort(ERR_PARSE);
          this.cSize = 0;
          this.cState = C_SIZE;
          break;
        case C_TRAILER_START:
          this.cState = buf[i++] === 13 ? C_END_LF : C_TRAILER_LINE;
          break;
        case C_TRAILER_LINE:
          if (buf[i++] === 10) this.cState = C_TRAILER_START;
          break;
        case C_END_LF:
          if (buf[i++] !== 10) return this.abort(ERR_PARSE);
          return this.finish(ERR_NONE);
      }
    }
  }
}
