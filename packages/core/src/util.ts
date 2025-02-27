import { GENAISCRIPT_FOLDER } from "./constants"
import { LogLevel, host } from "./host"

export function trimNewlines(s: string) {
    return s?.replace(/^\n*/, "").replace(/\n*$/, "")
}

export function delay<T>(millis: number, value?: T): Promise<T | undefined> {
    return new Promise((resolve) => setTimeout(() => resolve(value), millis))
}

export function strcmp(a: string, b: string) {
    if (a == b) return 0
    if (a < b) return -1
    else return 1
}

export function toArray<T>(a: ArrayLike<T>): T[] {
    if (!a) return undefined
    const r: T[] = new Array(a.length)
    for (let i = 0; i < a.length; ++i) r[i] = a[i]
    return r
}

export function assert(
    cond: boolean,
    msg = "Assertion failed",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debugData?: any
) {
    if (!cond) {
        if (debugData) console.error(`assertion failed ${msg}`, debugData)
        // eslint-disable-next-line no-debugger
        debugger
        throw new Error(msg)
    }
}

export function throttle(handler: () => void, delay: number): () => void {
    let enableCall = true
    return function () {
        if (!enableCall) return
        enableCall = false
        handler()
        setTimeout(() => (enableCall = true), delay)
    }
}

export function arrayShuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

export function range(end: number): number[] {
    return Array(end)
        .fill(0)
        .map((_, i) => i)
}

export function toggleBit(data: Uint8Array, bitindex: number) {
    data[bitindex >> 3] ^= 1 << (bitindex & 7)
}

export function getBit(data: Uint8Array, bitindex: number) {
    return !!(data[bitindex >> 3] & (1 << (bitindex & 7)))
}

export function setBit(data: Uint8Array, bitindex: number, on: boolean) {
    if (on) data[bitindex >> 3] |= 1 << (bitindex & 7)
    else data[bitindex >> 3] &= ~(1 << (bitindex & 7))
}

export function concatBuffers(...chunks: Uint8Array[]) {
    let sz = 0
    for (const ch of chunks) sz += ch.length
    const r = new Uint8Array(sz)
    sz = 0
    for (const ch of chunks) {
        r.set(ch, sz)
        sz += ch.length
    }
    return r
}

declare var require: any
export async function sha256(...buffers: Uint8Array[]) {
    if (typeof self === "undefined" || !window.crypto) {
        const req = require
        const s = req("crypto").createHash("sha256")
        for (const b of buffers) s.update(b)
        return Promise.resolve(new Uint8Array(s.digest()))
    }
    const r = await self.crypto.subtle.digest(
        "SHA-256",
        concatBuffers(...buffers)
    )
    return new Uint8Array(r)
}

export function toHex(bytes: ArrayLike<number>, sep?: string) {
    if (!bytes) return undefined
    let r = ""
    for (let i = 0; i < bytes.length; ++i) {
        if (sep && i > 0) r += sep
        r += ("0" + bytes[i].toString(16)).slice(-2)
    }
    return r
}

export function fromHex(hex: string) {
    const r = new Uint8Array(hex.length >> 1)
    for (let i = 0; i < hex.length; i += 2)
        r[i >> 1] = parseInt(hex.slice(i, i + 2), 16)
    return r
}

export function utf8Encode(s: string) {
    return host.createUTF8Encoder().encode(s)
}

export function utf8Decode(buf: Uint8Array) {
    return host.createUTF8Decoder().decode(buf)
}

export async function sha256string(s: string) {
    return toHex(await sha256(utf8Encode(s)))
}

// this will take lower 8 bits from each character
export function stringToUint8Array(input: string) {
    const len = input.length
    const res = new Uint8Array(len)
    for (let i = 0; i < len; ++i) res[i] = input.charCodeAt(i) & 0xff
    return res
}

export function uint8ArrayToString(input: ArrayLike<number>) {
    const len = input.length
    let res = ""
    for (let i = 0; i < len; ++i) res += String.fromCharCode(input[i])
    return res
}

declare var Buffer: any
export function fromBase64(encoded: string): Uint8Array {
    if (typeof Buffer == "function" && typeof Buffer.from == "function")
        return new Uint8Array(Buffer.from(encoded, "base64"))
    else return stringToUint8Array(atob(encoded))
}

export function toBase64(data: Uint8Array): string {
    if (typeof Buffer == "function" && typeof Buffer.from == "function")
        return Buffer.from(data).toString("base64")
    else return btoa(uint8ArrayToString(data))
}

export function dotGenaiscriptPath(...segments: string[]) {
    return host.resolvePath(
        host.projectFolder(),
        GENAISCRIPT_FOLDER,
        ...segments
    )
}

export function splitPath(path: string) {
    let dirname = "."
    let filename = path
    path.replace(/(.*)[\/\\](.*)/, (_, a, b) => {
        dirname = a
        filename = b
        return ""
    })
    return [dirname, filename]
}

export function relativePath(root: string, path: string) {
    if (path.startsWith(root)) {
        path = path.slice(root.length)
        return path.replace(/^[\/\\]+/, "")
    }
    return path
}

export function logInfo(msg: string) {
    host.log(LogLevel.Info, msg)
}

export function logVerbose(msg: string) {
    host.log(LogLevel.Verbose, msg)
}

export function logWarn(msg: string) {
    host.log(LogLevel.Warn, msg)
}

export function logError(msg: string) {
    host.log(LogLevel.Error, msg)
}

export function concatArrays<T>(...arrays: T[][]): T[] {
    if (arrays.length == 0) return []
    return arrays[0].concat(...arrays.slice(1))
}

export function randomRange(min: number, max: number) {
    return Math.round(Math.random() * (max - min) + min)
}

export function last<T>(a: ArrayLike<T>) {
    return a[a.length - 1]
}

export function groupBy<T>(
    list: T[],
    key: (value: T) => string
): Record<string, T[]> {
    if (!list) return {}

    const r: Record<string, T[]> = {}
    list.forEach((item) => {
        const k = key(item)
        const a = r[k] || (r[k] = [])
        a.push(item)
    })
    return r
}

export function normalizeFloat(s: string) {
    const f = parseFloat(s)
    return isNaN(f) ? undefined : f
}

export function normalizeInt(s: string) {
    const f = parseInt(s)
    return isNaN(f) ? undefined : f
}
