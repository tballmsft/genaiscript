import { CancellationToken } from "./cancellation"
import { Progress } from "./progress"
import { MarkdownTrace } from "./trace"

// this is typically an instance of TextDecoder
export interface UTF8Decoder {
    decode(
        input: Uint8Array,
        options?: {
            stream?: boolean | undefined
        }
    ): string
}

export interface UTF8Encoder {
    encode(input: string): Uint8Array
}

export enum LogLevel {
    Verbose = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

export type APIType = "openai" | "azure" | "local" | "llama"

export interface OAIToken {
    base: string
    token: string
    type?: APIType
    source?: string
    aici?: boolean
    version?: string
}

export interface ReadFileOptions {
    virtual?: boolean
}

export interface ShellOutput {
    stdout?: string
    stderr?: string
    output?: string
    exitCode: number
    failed: boolean
}

export interface ShellCallOptions {
    cwd?: string
    timeout?: number
    stdin?: string
    outputdir: string
    stdinfile: string
    stdoutfile: string
    stderrfile: string
    exitcodefile: string
}

export interface RetreivalClientOptions {
    progress?: Progress
    token?: CancellationToken
    trace?: MarkdownTrace
}

export interface ResponseStatus {
    ok: boolean
    error?: string
    status?: number
}

export interface RetreivalOptions {
    indexName?: string
    summary?: boolean
}

export interface RetreivalSearchOptions extends RetreivalOptions {
    files?: string[]
    topK?: number
    minScore?: number
}

export interface RetreivalUpsertOptions extends RetreivalOptions {
    content?: string
    mimeType?: string
    model?: string
    chunkSize?: number
    chunkOverlap?: number
    splitLongSentences?: boolean
}

export type RetreivalSearchResponse = ResponseStatus & {
    results: {
        filename: string
        id: string
        text: string
        score?: number
    }[]
}

export interface RetreivalService {
    init(trace?: MarkdownTrace): Promise<void>
    clear(options?: RetreivalOptions): Promise<ResponseStatus>
    upsert(
        filenameOrUrl: string,
        options?: RetreivalUpsertOptions
    ): Promise<ResponseStatus>
    search(
        text: string,
        options?: RetreivalSearchOptions
    ): Promise<RetreivalSearchResponse>
}

export type HighlightResponse = ResponseStatus & { response: string }

export type ServerResponse = ResponseStatus & { version: string }

export interface HighlightService {
    init(trace?: MarkdownTrace): Promise<void>
    outline(files: LinkedFile[]): Promise<HighlightResponse>
}

export interface ServerManager {
    start(): Promise<void>
    close(): Promise<void>
}

export interface Host {
    userState: any

    retreival: RetreivalService
    highlight: HighlightService
    server: ServerManager
    path: Path
    fs: FileSystem

    createUTF8Decoder(): UTF8Decoder
    createUTF8Encoder(): UTF8Encoder
    projectFolder(): string
    installFolder(): string
    resolvePath(...segments: string[]): string

    // read a secret from the environment or a .env file
    readSecret(name: string): Promise<string | undefined>
    getSecretToken(template: ModelOptions): Promise<OAIToken | undefined>

    log(level: LogLevel, msg: string): void

    // fs
    readFile(name: string, options?: ReadFileOptions): Promise<Uint8Array>
    writeFile(name: string, content: Uint8Array): Promise<void>
    deleteFile(name: string): Promise<void>
    findFiles(glob: string): Promise<string[]>

    clearVirtualFiles(): void
    setVirtualFile(name: string, content: string): void
    isVirtualFile(name: string): boolean

    // This has mkdirp-semantics (parent directories are created and existing ignored)
    createDirectory(name: string): Promise<void>
    deleteDirectory(name: string): Promise<void>

    // executes a process
    exec(
        command: string,
        args: string[],
        options: ShellCallOptions
    ): Promise<Partial<ShellOutput>>
}

export let host: Host

export function setHost(h: Host) {
    host = h
}
