/**
 * A small, dependency-free text reader for the PDFs the House Clerk posts as Periodic Transaction Reports (PTR). SERVER ONLY
 * (Node `zlib` and `crypto`); the browser never sees a PDF.
 *
 * Why not a library: the reports are produced by ONE generator (typed forms: RC4-128 encrypted with an empty user password,
 * Flate content streams, TrueType fonts with `Identity-H` + `ToUnicode`, text set with absolute `Tm` / `Td` runs). A reader for
 * exactly that is a few hundred lines and adds no dependency to the project (and no change to the shared `node_modules`). It is
 * deliberately NOT a general PDF engine: whatever it does not understand is a typed `PdfError` and the row/report is shown as
 * "nicht lesbar" with the link to the original – never guessed.
 *
 * Supported: classic xref files (objects found by scanning), `Standard` security handler V1/V2/V4 with an empty user password
 * (RC4 40/128, AES-128 `AESV2`), `FlateDecode` (also as a filter array), simple and `Type0` fonts with a `ToUnicode` CMap (or a
 * single-byte simple font without one, read as Latin-1), form XObjects, `q Q cm BT ET Tf Tm Td TD T* Tj TJ ' " TL Do`.
 * Not supported (typed error): object streams (`/Type /ObjStm`), AES-256 (V5), other filters, a password.
 * Scanned paper filings are images without text: `pageText` returns no items for them (`kind: "no-text"` is raised by the caller).
 *
 * Output: per page the text runs with their start position in a top-down page coordinate system (`y` grows downward), runs
 * of one cell on one baseline already joined (the generator emits one `Td` per run, its spaces are real glyphs).
 */
import { createDecipheriv, createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * `scan`: a paper filing the Clerk scanned (page images, no text layer, compressed object streams);
 * `unsupported`: a structure this reader does not know; `encrypted`: a password; `damaged`: not a readable PDF.
 */
export type PdfErrorKind = "scan" | "unsupported" | "encrypted" | "damaged";

export class PdfError extends Error {
  readonly kind: PdfErrorKind;
  constructor(kind: PdfErrorKind, message: string) {
    super(message);
    this.name = "PdfError";
    this.kind = kind;
  }
}

export interface TextItem {
  /** left edge of the run, page units (1/72 inch) */
  x: number;
  /** baseline, page units, growing DOWNWARD from the top edge */
  y: number;
  text: string;
  /** effective font size in page units */
  size: number;
}

export interface PdfPageText {
  width: number;
  height: number;
  items: TextItem[];
}

/* -------------------------------------------------------------------------------------------- object syntax */

interface Name {
  name: string;
}
interface Ref {
  ref: number;
}
type Dict = Map<string, Value>;
type Value = number | boolean | null | string | Name | Ref | Value[] | Dict;
/** a PDF string is a JS string (one char per byte); a name is `{ name }` – so `typeof v === "string"` means string */

const isName = (v: Value | undefined): v is Name => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Map) && "name" in v;
const isRef = (v: Value | undefined): v is Ref => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Map) && "ref" in v;
const isDict = (v: Value | undefined): v is Dict => v instanceof Map;
const isArr = (v: Value | undefined): v is Value[] => Array.isArray(v);

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "str"; v: string } | { t: "kw"; v: string } | { t: "[" } | { t: "]" } | { t: "<<" } | { t: ">>" };

const WS = (c: number): boolean => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const DELIM = (c: number): boolean => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

class Lexer {
  i: number;
  constructor(
    readonly s: string,
    start = 0,
  ) {
    this.i = start;
  }

  private skip(): void {
    const { s } = this;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 0x25) {
        while (this.i < s.length && s.charCodeAt(this.i) !== 0x0a && s.charCodeAt(this.i) !== 0x0d) this.i++;
      } else if (WS(c)) this.i++;
      else break;
    }
  }

  next(): Tok | null {
    this.skip();
    const { s } = this;
    if (this.i >= s.length) return null;
    const c = s.charCodeAt(this.i);
    if (c === 0x5b) return this.i++, { t: "[" };
    if (c === 0x5d) return this.i++, { t: "]" };
    if (c === 0x3c) {
      if (s.charCodeAt(this.i + 1) === 0x3c) return (this.i += 2), { t: "<<" };
      const end = s.indexOf(">", this.i);
      if (end < 0) throw new PdfError("damaged", "hex string without end");
      const hex = s.slice(this.i + 1, end).replace(/[^0-9a-fA-F]/g, "");
      this.i = end + 1;
      let out = "";
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
      return { t: "str", v: out };
    }
    if (c === 0x3e) {
      if (s.charCodeAt(this.i + 1) === 0x3e) return (this.i += 2), { t: ">>" };
      this.i++;
      return this.next();
    }
    if (c === 0x28) return this.literal();
    if (c === 0x2f) {
      let j = this.i + 1;
      while (j < s.length && !WS(s.charCodeAt(j)) && !DELIM(s.charCodeAt(j))) j++;
      const raw = s.slice(this.i + 1, j);
      this.i = j;
      return { t: "name", v: raw.replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))) };
    }
    let j = this.i;
    while (j < s.length && !WS(s.charCodeAt(j)) && !DELIM(s.charCodeAt(j))) j++;
    if (j === this.i) {
      // a stray delimiter ( ) { } – skip it
      this.i++;
      return this.next();
    }
    const word = s.slice(this.i, j);
    this.i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: Number(word) };
    return { t: "kw", v: word };
  }

  private literal(): Tok {
    const { s } = this;
    let depth = 1;
    let out = "";
    this.i++;
    while (this.i < s.length) {
      const ch = s[this.i]!;
      this.i++;
      if (ch === "\\") {
        const e = s[this.i] ?? "";
        this.i++;
        if (e === "n") out += "\n";
        else if (e === "r") out += "\r";
        else if (e === "t") out += "\t";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e >= "0" && e <= "7") {
          let oct = e;
          while (oct.length < 3 && (s[this.i] ?? "") >= "0" && (s[this.i] ?? "") <= "7") oct += s[this.i++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (e === "\r") {
          if (s[this.i] === "\n") this.i++;
        } else if (e !== "\n") out += e;
      } else if (ch === "(") {
        depth++;
        out += ch;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) return { t: "str", v: out };
        out += ch;
      } else out += ch;
    }
    throw new PdfError("damaged", "string without end");
  }
}

/** Reads one object; `refs` lets `12 0 R` become a reference (objects), off in content streams. A bare keyword is returned as `{ op }`. */
function readValue(lx: Lexer, first: Tok | null, refs: boolean, depth = 0): Value | { op: string } | undefined {
  if (depth > 40) throw new PdfError("damaged", "objects nested too deeply");
  const t = first ?? lx.next();
  if (!t) return undefined;
  switch (t.t) {
    case "num": {
      if (refs && Number.isInteger(t.v) && t.v >= 0) {
        const save = lx.i;
        const g = lx.next();
        if (g && g.t === "num" && Number.isInteger(g.v)) {
          const r = lx.next();
          if (r && r.t === "kw" && r.v === "R") return { ref: t.v };
        }
        lx.i = save;
      }
      return t.v;
    }
    case "name":
      return { name: t.v };
    case "str":
      return t.v;
    case "[": {
      const out: Value[] = [];
      for (;;) {
        const n = lx.next();
        if (!n) throw new PdfError("damaged", "array without end");
        if (n.t === "]") return out;
        const v = readValue(lx, n, refs, depth + 1);
        if (v === undefined) throw new PdfError("damaged", "array without end");
        if (typeof v === "object" && v !== null && "op" in v && !Array.isArray(v) && !(v instanceof Map)) continue;
        out.push(v as Value);
      }
    }
    case "<<": {
      const d: Dict = new Map();
      for (;;) {
        const k = lx.next();
        if (!k) throw new PdfError("damaged", "dictionary without end");
        if (k.t === ">>") return d;
        if (k.t !== "name") continue;
        const v = readValue(lx, null, refs, depth + 1);
        if (v === undefined) throw new PdfError("damaged", "dictionary without end");
        if (typeof v === "object" && v !== null && "op" in v && !Array.isArray(v) && !(v instanceof Map)) continue;
        d.set(k.v, v as Value);
      }
    }
    case "kw":
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "null") return null;
      return { op: t.v };
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------------------------------------- crypto */

function rc4(key: Buffer, data: Buffer): Buffer {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 255;
    const t = S[i]!;
    S[i] = S[j]!;
    S[j] = t;
  }
  const out = Buffer.allocUnsafe(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255;
    b = (b + S[a]!) & 255;
    const t = S[a]!;
    S[a] = S[b]!;
    S[b] = t;
    out[k] = data[k]! ^ S[(S[a]! + S[b]!) & 255]!;
  }
  return out;
}

const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...parts: Buffer[]): Buffer => {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return h.digest();
};
const latin1 = (s: string): Buffer => Buffer.from(s, "latin1");
const int32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0, 0);
  return b;
};

interface Crypt {
  key: Buffer;
  aes: boolean;
}

/* -------------------------------------------------------------------------------------------------- document */

interface RawObj {
  num: number;
  gen: number;
  value: Value | undefined;
  /** byte range of the stream data in the file text, when the object has one */
  stream?: { start: number; end: number };
}

const MAT_ID = [1, 0, 0, 1, 0, 0] as const;
type Mat = readonly [number, number, number, number, number, number];
/** `a × b` in PDF's row-vector convention: apply `a` first, then `b` */
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

interface FontInfo {
  /** bytes per character code */
  width: 1 | 2;
  map: Map<number, string> | null;
}

const MAX_BYTES = 12 * 1024 * 1024;

export class PdfDoc {
  private readonly text: string;
  private readonly objs = new Map<number, RawObj>();
  private crypt: Crypt | null = null;
  private readonly fontCache = new Map<number, FontInfo>();
  private trailerText = "";

  constructor(bytes: Uint8Array) {
    if (bytes.length > MAX_BYTES) throw new PdfError("unsupported", "PDF too large");
    this.text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
    if (!this.text.startsWith("%PDF-")) throw new PdfError("damaged", "not a PDF");
    this.scan();
    this.setupCrypt();
  }

  /* ------------------------------------------------------------------ objects */

  private scan(): void {
    const { text } = this;
    const re = /(?:^|[\r\n\s])(\d{1,9})\s+(\d{1,5})\s+obj\b/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const num = Number(m[1]);
      const gen = Number(m[2]);
      const lx = new Lexer(text, m.index + m[0].length);
      let value: Value | undefined;
      try {
        const v = readValue(lx, null, true);
        value = v !== undefined && !(typeof v === "object" && v !== null && "op" in v && !Array.isArray(v) && !(v instanceof Map)) ? (v as Value) : undefined;
      } catch {
        continue;
      }
      const o: RawObj = { num, gen, value };
      // `stream` directly follows the dictionary
      const probe = lx.i;
      let k = probe;
      while (k < text.length && WS(text.charCodeAt(k))) k++;
      if (text.startsWith("stream", k)) {
        let start = k + 6;
        if (text[start] === "\r" && text[start + 1] === "\n") start += 2;
        else if (text[start] === "\n" || text[start] === "\r") start += 1;
        const len = isDict(value) ? value.get("Length") : undefined;
        let end = -1;
        if (typeof len === "number" && len >= 0 && start + len <= text.length) {
          const after = text.slice(start + len, start + len + 24);
          if (/^\s*endstream/.test(after)) end = start + len;
        }
        if (end < 0) {
          const e = text.indexOf("endstream", start);
          if (e < 0) throw new PdfError("damaged", "stream without end");
          end = e;
          if (text[end - 1] === "\n") end--;
          if (text[end - 1] === "\r") end--;
        }
        o.stream = { start, end };
        re.lastIndex = Math.max(re.lastIndex, end);
      }
      this.objs.set(num, o);
      if (isDict(value) && isName(value.get("Type")) && (value.get("Type") as Name).name === "ObjStm") {
        // a scanned paper filing is a stack of page images (CCITT / JBIG2 / JPEG) in a 1.5 file with no font anywhere
        if (/\/Subtype\s*\/Image\b/.test(text) && !/\/Font\b/.test(text)) throw new PdfError("scan", "scanned images without text");
        throw new PdfError("unsupported", "object streams");
      }
    }
    if (!this.objs.size) throw new PdfError("damaged", "no objects");
    // the trailer: the last `trailer` dictionary (classic files) – an xref stream's dictionary is itself an object and found below
    const t = this.text.lastIndexOf("trailer");
    this.trailerText = t >= 0 ? this.text.slice(t) : "";
  }

  private get<T extends Value>(v: Value | undefined): T | undefined {
    let cur = v;
    for (let hops = 0; isRef(cur) && hops < 16; hops++) cur = this.objs.get(cur.ref)?.value;
    return cur as T | undefined;
  }

  private dict(v: Value | undefined): Dict | undefined {
    const d = this.get<Value>(v);
    return isDict(d) ? d : undefined;
  }

  private nameOf(v: Value | undefined): string | undefined {
    const n = this.get<Value>(v);
    return isName(n) ? n.name : undefined;
  }

  /* -------------------------------------------------------------- encryption */

  private setupCrypt(): void {
    const tr = this.trailerText;
    let encRef: number | null = null;
    const m = /\/Encrypt\s+(\d+)\s+\d+\s+R/.exec(tr);
    if (m) encRef = Number(m[1]);
    let encDict: Dict | undefined;
    if (encRef !== null) encDict = this.dict({ ref: encRef });
    else if (/\/Encrypt\s*<</.test(tr)) {
      const at = tr.search(/\/Encrypt\s*<</);
      const lx = new Lexer(tr, at + 8);
      encDict = readValue(lx, null, true) as Dict;
    }
    if (!encDict) {
      // an xref-stream file keeps /Encrypt in the stream dictionary; not supported, but then there is no `trailer` either
      if (!tr && /\/Encrypt\b/.test(this.text.slice(-2048))) throw new PdfError("unsupported", "xref stream with encryption");
      return;
    }
    const filter = this.nameOf(encDict.get("Filter"));
    if (filter !== "Standard") throw new PdfError("unsupported", "security handler");
    const V = Number(this.get<number>(encDict.get("V")) ?? 0);
    const R = Number(this.get<number>(encDict.get("R")) ?? 0);
    if (![1, 2, 4].includes(V) || ![2, 3, 4].includes(R)) throw new PdfError("unsupported", `encryption V${V} R${R}`);
    let lengthBits = Number(this.get<number>(encDict.get("Length")) ?? 40);
    let aes = false;
    if (V === 4) {
      const cf = this.dict(encDict.get("CF"));
      const stmf = this.nameOf(encDict.get("StmF")) ?? "Identity";
      const f = stmf === "Identity" ? undefined : this.dict(cf?.get(stmf));
      const cfm = this.nameOf(f?.get("CFM"));
      if (stmf === "Identity" || cfm === "None") throw new PdfError("unsupported", "unencrypted stream filter");
      if (cfm === "AESV2") aes = true;
      else if (cfm !== "V2") throw new PdfError("unsupported", `crypt filter ${cfm ?? "?"}`);
      lengthBits = 128;
    }
    const o = this.get<string>(encDict.get("O"));
    const p = this.get<number>(encDict.get("P"));
    if (typeof o !== "string" || typeof p !== "number") throw new PdfError("damaged", "encryption dictionary incomplete");
    const idm = /\/ID\s*\[\s*<([0-9a-fA-F]*)>/.exec(tr) ?? /\/ID\s*\[\s*\(([^)]*)\)/.exec(tr);
    const id0 = idm ? (/\/ID\s*\[\s*</.test(tr) ? Buffer.from(idm[1]!, "hex") : latin1(idm[1]!)) : Buffer.alloc(0);
    const n = R === 2 ? 5 : Math.max(5, Math.min(16, Math.floor(lengthBits / 8)));
    const noMeta = V === 4 && this.get<boolean>(encDict.get("EncryptMetadata")) === false;
    let h = md5(PAD, latin1(o).subarray(0, 32), int32le(p), id0, noMeta ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
    this.crypt = { key: h.subarray(0, n), aes };
  }

  private decrypt(o: RawObj, data: Buffer): Buffer {
    const c = this.crypt;
    if (!c) return data;
    const k = md5(c.key, Buffer.from([o.num & 255, (o.num >> 8) & 255, (o.num >> 16) & 255, o.gen & 255, (o.gen >> 8) & 255]), c.aes ? Buffer.from("sAlT") : Buffer.alloc(0)).subarray(0, Math.min(c.key.length + 5, 16));
    if (!c.aes) return rc4(k, data);
    if (data.length < 32 || data.length % 16 !== 0) throw new PdfError("damaged", "AES stream length");
    const d = createDecipheriv("aes-128-cbc", k, data.subarray(0, 16));
    return Buffer.concat([d.update(data.subarray(16)), d.final()]);
  }

  /* ---------------------------------------------------------------- streams */

  /** The decoded bytes of a stream object, or `null` when `v` is not one. */
  private streamOf(v: Value | undefined): Buffer | null {
    let cur = v;
    for (let hops = 0; isRef(cur) && hops < 16; hops++) {
      const o = this.objs.get(cur.ref);
      if (!o) return null;
      if (o.stream) return this.decode(o);
      cur = o.value;
    }
    return null;
  }

  private decode(o: RawObj): Buffer {
    const { start, end } = o.stream!;
    let data: Buffer = latin1(this.text.slice(start, end));
    const dict = isDict(o.value) ? o.value : new Map<string, Value>();
    data = this.decrypt(o, data);
    const f = this.get<Value>(dict.get("Filter"));
    const filters = f === undefined ? [] : isArr(f) ? f.map((x) => this.nameOf(x)) : [this.nameOf(f)];
    for (const name of filters) {
      if (name === "FlateDecode" || name === "Fl") {
        try {
          data = inflateSync(data);
        } catch {
          // a wrong key (password) and a damaged file look the same here
          throw new PdfError(this.crypt ? "encrypted" : "damaged", "stream could not be decompressed");
        }
      } else if (name !== undefined) throw new PdfError("unsupported", `filter ${name}`);
    }
    return data;
  }

  /* ------------------------------------------------------------------ pages */

  private pageList(): Dict[] {
    const rootRef = /\/Root\s+(\d+)\s+\d+\s+R/.exec(this.trailerText);
    let root: Dict | undefined = rootRef ? this.dict({ ref: Number(rootRef[1]) }) : undefined;
    if (!root) {
      for (const o of this.objs.values()) if (isDict(o.value) && this.nameOf(o.value.get("Type")) === "Catalog") root = o.value;
    }
    const pages = root ? this.dict(root.get("Pages")) : undefined;
    if (!pages) throw new PdfError("damaged", "no page tree");
    const out: Dict[] = [];
    const walk = (node: Dict, inherited: Map<string, Value>, depth: number): void => {
      if (depth > 16 || out.length > 200) return;
      const next = new Map(inherited);
      for (const k of ["Resources", "MediaBox"]) {
        const v = node.get(k);
        if (v !== undefined) next.set(k, v);
      }
      const kids = this.get<Value>(node.get("Kids"));
      if (this.nameOf(node.get("Type")) === "Pages" && isArr(kids)) {
        for (const kid of kids) {
          const d = this.dict(kid);
          if (d) walk(d, next, depth + 1);
        }
        return;
      }
      const page = new Map(node);
      for (const [k, v] of next) if (!page.has(k)) page.set(k, v);
      out.push(page);
    };
    walk(pages, new Map(), 0);
    return out;
  }

  /** Text runs of every page (at most `maxPages`). */
  pages(maxPages = 40): PdfPageText[] {
    const result: PdfPageText[] = [];
    for (const page of this.pageList().slice(0, maxPages)) {
      const box = this.get<Value>(page.get("MediaBox"));
      const nums = isArr(box) ? box.map((v) => Number(this.get<number>(v))) : [0, 0, 612, 792];
      const width = (nums[2] ?? 612) - (nums[0] ?? 0);
      const height = (nums[3] ?? 792) - (nums[1] ?? 0);
      const contents = this.get<Value>(page.get("Contents"));
      const parts = isArr(contents) ? contents : contents === undefined ? [] : [page.get("Contents") as Value];
      const streams: string[] = [];
      for (const p of parts) {
        const b = this.streamOf(p);
        if (b) streams.push(b.toString("latin1"));
      }
      const items: TextItem[] = [];
      const res = this.dict(page.get("Resources"));
      this.run(streams.join("\n"), res, MAT_ID, height, items, 0);
      result.push({ width, height, items });
    }
    return result;
  }

  /* ------------------------------------------------------------------ fonts */

  private fontOf(res: Dict | undefined, name: string): FontInfo {
    const fonts = this.dict(res?.get("Font"));
    const ref = fonts?.get(name);
    const fd = this.dict(ref);
    const key = isRef(ref) ? ref.ref : -1;
    const hit = key >= 0 ? this.fontCache.get(key) : undefined;
    if (hit) return hit;
    let info: FontInfo = { width: 1, map: null };
    if (fd) {
      const sub = this.nameOf(fd.get("Subtype"));
      const enc = this.get<Value>(fd.get("Encoding"));
      const two = sub === "Type0" || (isName(enc) && /^Identity-[HV]$/.test(enc.name));
      const tu = this.streamOf(fd.get("ToUnicode"));
      info = tu ? parseToUnicode(tu.toString("latin1"), two ? 2 : 1) : { width: two ? 2 : 1, map: null };
    }
    if (key >= 0) this.fontCache.set(key, info);
    return info;
  }

  /* -------------------------------------------------------- content streams */

  private run(src: string, res: Dict | undefined, base: Mat, pageHeight: number, items: TextItem[], depth: number): void {
    if (depth > 4) return;
    const lx = new Lexer(src);
    const stack: Value[] = [];
    let ctm: Mat = base;
    const saved: { ctm: Mat }[] = [];
    let tm: Mat = MAT_ID;
    let tlm: Mat = MAT_ID;
    let font: FontInfo = { width: 1, map: null };
    let size = 1;
    let leading = 0;
    let cur: (TextItem & { lastX: number; lastLen: number }) | null = null;
    let guard = 0;

    const flush = (): void => {
      if (cur && cur.text.trim()) items.push({ x: cur.x, y: cur.y, text: cur.text, size: cur.size });
      cur = null;
    };
    const show = (raw: string): void => {
      // the form's small-capital labels ("FILING STATUS") map their lower glyphs to U+0000: dropped, the label stays "F S:"
      const text = decodeText(raw, font).replace(/\u0000/g, "");
      if (!text) return;
      const t = mul(tm, ctm);
      const x = t[4];
      const y = pageHeight - t[5];
      const scale = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) * size;
      if (cur && Math.abs(cur.y - y) < 0.4 && x >= cur.lastX - 0.5 && x - cur.lastX <= cur.lastLen * Math.max(cur.size, 1) * 0.95 + 2) {
        cur.text += text;
        cur.lastX = x;
        cur.lastLen = text.length;
        return;
      }
      flush();
      cur = { x, y, text, size: scale, lastX: x, lastLen: text.length };
    };
    const num = (k: number): number => {
      const v = stack[stack.length - 1 - k];
      return typeof v === "number" ? v : 0;
    };
    const td = (tx: number, ty: number): void => {
      tlm = mul([1, 0, 0, 1, tx, ty], tlm);
      tm = tlm;
    };

    for (let v = readValue(lx, null, false); v !== undefined; v = readValue(lx, null, false)) {
      if (++guard > 400_000) throw new PdfError("damaged", "content stream too long");
      if (typeof v === "object" && v !== null && "op" in v && !Array.isArray(v) && !(v instanceof Map)) {
        const op = v.op;
        switch (op) {
          case "q":
            saved.push({ ctm });
            break;
          case "Q": {
            const s = saved.pop();
            if (s) ctm = s.ctm;
            break;
          }
          case "cm":
            ctm = mul([num(5), num(4), num(3), num(2), num(1), num(0)], ctm);
            break;
          case "BT":
            flush();
            tm = MAT_ID;
            tlm = MAT_ID;
            break;
          case "ET":
            flush();
            break;
          case "Tf": {
            const nm = stack[stack.length - 2];
            if (isName(nm)) font = this.fontOf(res, nm.name);
            size = num(0);
            break;
          }
          case "TL":
            leading = num(0);
            break;
          case "Tm":
            flush();
            tm = [num(5), num(4), num(3), num(2), num(1), num(0)];
            tlm = tm;
            break;
          case "Td":
            td(num(1), num(0));
            break;
          case "TD":
            leading = -num(0);
            td(num(1), num(0));
            break;
          case "T*":
            td(0, -leading);
            break;
          case "Tj": {
            const s = stack[stack.length - 1];
            if (typeof s === "string") show(s);
            break;
          }
          case "'":
          case '"': {
            td(0, -leading);
            const s = stack[stack.length - 1];
            if (typeof s === "string") show(s);
            break;
          }
          case "TJ": {
            const arr = stack[stack.length - 1];
            if (isArr(arr)) for (const part of arr) if (typeof part === "string") show(part);
            break;
          }
          case "Do": {
            const nm = stack[stack.length - 1];
            if (isName(nm)) {
              const xo = this.dict(res?.get("XObject"));
              const ref = xo?.get(nm.name);
              const fd = this.dict(ref);
              if (fd && this.nameOf(fd.get("Subtype")) === "Form") {
                const body = this.streamOf(ref);
                if (body) {
                  const mat = this.get<Value>(fd.get("Matrix"));
                  const m: Mat = isArr(mat) && mat.length === 6 ? (mat.map((x) => Number(x)) as unknown as Mat) : MAT_ID;
                  flush();
                  this.run(body.toString("latin1"), this.dict(fd.get("Resources")) ?? res, mul(m, ctm), pageHeight, items, depth + 1);
                }
              }
            }
            break;
          }
          default:
            break;
        }
        stack.length = 0;
        continue;
      }
      stack.push(v as Value);
      if (stack.length > 64) stack.shift();
    }
    flush();
  }
}

function decodeText(raw: string, font: FontInfo): string {
  if (!font.map) return font.width === 1 ? raw : "";
  let out = "";
  if (font.width === 1) {
    for (let i = 0; i < raw.length; i++) out += font.map.get(raw.charCodeAt(i)) ?? "";
  } else {
    for (let i = 0; i + 1 < raw.length; i += 2) out += font.map.get((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1)) ?? "";
  }
  return out;
}

const hexToUtf16 = (hex: string): string => {
  let out = "";
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const unit = parseInt(hex.slice(i, i + 4), 16);
    if (Number.isFinite(unit)) out += String.fromCharCode(unit);
  }
  return out;
};

/** `bfchar` / `bfrange` of a ToUnicode CMap. */
export function parseToUnicode(cmap: string, defaultWidth: 1 | 2): FontInfo {
  const map = new Map<number, string>();
  let width: 1 | 2 = defaultWidth;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/.exec(cmap);
  if (cs) width = cs[1]!.length <= 2 ? 1 : 2;
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1]!, 16), hexToUtf16(m[2]!));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1]!, 16);
      const hi = Math.min(parseInt(m[2]!, 16), lo + 65535);
      if (m[3] !== undefined) {
        const start = hexToUtf16(m[3]);
        for (let c = lo; c <= hi; c++) {
          const last = start.charCodeAt(start.length - 1) + (c - lo);
          map.set(c, start.slice(0, -1) + String.fromCharCode(last));
        }
      } else if (m[4] !== undefined) {
        const list = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)];
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, hexToUtf16(list[c - lo]![1]!));
      }
    }
  }
  return { width, map };
}

/** Text of a PDF, page by page. Throws `PdfError`. */
export function readPdfText(bytes: Uint8Array): PdfPageText[] {
  return new PdfDoc(bytes).pages();
}
