import * as vscode from "vscode"
import {
    ChatCompletionsProgressReport,
    Project,
    Fragment,
    PromptTemplate,
    concatArrays,
    parseProject,
    FragmentTransformResponse,
    runTemplate,
    groupBy,
    promptDefinitions,
    RunTemplateOptions,
    isCancelError,
    isTokenError,
    initToken,
    isRequestError,
    delay,
    CHANGE,
    Cache,
    logInfo,
    logMeasure,
    parseAnnotations,
    MarkdownTrace,
    CORE_VERSION,
    sha256string,
    dotGenaiscriptPath,
    CLI_JS,
    TOOL_ID,
    GENAI_EXT,
    TOOL_NAME,
    RetreivalSearchResult,
    AbortSignalCancellationToken,
} from "genaiscript-core"
import { ExtensionContext } from "vscode"
import { debounceAsync } from "./debounce"
import { VSCodeHost } from "./vshost"
import { applyEdits, toRange } from "./edit"
import { Utils } from "vscode-uri"
import {
    findFiles,
    listFiles,
    readFileText,
    saveAllTextDocuments,
    writeFile,
} from "./fs"
import { configureLanguageModelAccess, pickLanguageModel } from "./lmaccess"

const MAX_HISTORY_LENGTH = 500

export const TOKEN_DOCUMENTATION_URL =
    "https://github.com/microsoft/genaiscript/blob/main/docs/token.md"
export const CONTEXT_LENGTH_DOCUMENTATION_URL =
    "https://github.com/microsoft/genaiscript/blob/main/docs/token.md"

export const FRAGMENTS_CHANGE = "fragmentsChange"
export const AI_REQUEST_CHANGE = "aiRequestChange"

export const REQUEST_OUTPUT_FILENAME = "GenAIScript Output.md"
export const REQUEST_TRACE_FILENAME = "GenAIScript Trace.md"
export const SEARCH_OUTPUT_FILENAME = "GenAIScript Search.md"

export interface AIRequestOptions {
    label: string
    template: PromptTemplate
    fragment: Fragment
}

export class FragmentsEvent extends Event {
    constructor(readonly fragments?: Fragment[]) {
        super(FRAGMENTS_CHANGE)
    }
}
export interface AIRequestSnapshotKey {
    template: {
        id: string
        title: string
        hash: string
    }
    fragment: {
        fullId: string
        hash: string
    }
    version: string
}
export interface AIRequestSnapshot {
    response?: Partial<FragmentTransformResponse>
    error?: any
    trace?: string
}

export interface AIRequest {
    creationTime: string
    options: AIRequestOptions
    controller: AbortController
    trace: MarkdownTrace
    request?: Promise<FragmentTransformResponse>
    response?: Partial<FragmentTransformResponse>
    computing?: boolean
    error?: any
    progress?: ChatCompletionsProgressReport
    editsApplied?: boolean // null = waiting, false, true
}

export async function snapshotAIRequestKey(
    r: AIRequest
): Promise<AIRequestSnapshotKey> {
    const { options, request } = r
    const key = {
        template: {
            id: options.template.id,
            title: options.template.title,
            hash: await sha256string(JSON.stringify(options.template)),
        },
        fragment: {
            fullId: options.fragment.fullId,
            hash: options.fragment.hash,
        },
        version: CORE_VERSION,
    }
    return key
}

export function snapshotAIRequest(r: AIRequest): AIRequestSnapshot {
    const { response, error, creationTime } = r
    const { vars, ...responseWithoutVars } = response || {}
    const snapshot = structuredClone({
        creationTime,
        cacheTime: new Date().toISOString(),
        response: responseWithoutVars,
        error,
        trace: r.trace.content,
    })
    return snapshot
}

function getAIRequestCache() {
    return Cache.byName<AIRequestSnapshotKey, AIRequestSnapshot>("airequests")
}

export class ExtensionState extends EventTarget {
    readonly host: VSCodeHost
    private _parseWorkspacePromise: Promise<void>
    private _project: Project = undefined
    private _aiRequest: AIRequest = undefined
    private _diagColl: vscode.DiagnosticCollection
    private _aiRequestCache: Cache<AIRequestSnapshotKey, AIRequestSnapshot> =
        undefined
    readonly output: vscode.LogOutputChannel

    lastSearch: RetreivalSearchResult

    constructor(public readonly context: ExtensionContext) {
        super()
        this.output = vscode.window.createOutputChannel(TOOL_NAME, {
            log: true,
        })
        this.host = new VSCodeHost(this)
        this.host.addEventListener(CHANGE, this.dispatchChange.bind(this))
        const { subscriptions } = context
        subscriptions.push(this)

        this._diagColl = vscode.languages.createDiagnosticCollection(TOOL_NAME)
        subscriptions.push(this._diagColl)

        this._aiRequestCache = getAIRequestCache()

        // clear errors when file edited (remove me?)
        vscode.workspace.onDidChangeTextDocument(
            (ev) => {
                this._diagColl.set(ev.document.uri, [])
            },
            undefined,
            subscriptions
        )
    }

    private async saveScripts() {
        const dir = vscode.Uri.file(dotGenaiscriptPath("."))
        await vscode.workspace.fs.createDirectory(dir)

        const p = Utils.joinPath(this.context.extensionUri, CLI_JS)
        const cli = vscode.Uri.file(dotGenaiscriptPath(CLI_JS))

        // genaiscript.cjs
        await vscode.workspace.fs.copy(p, cli, { overwrite: true })
        // add .gitignore
        await writeFile(
            dir,
            ".gitattributes",
            `# avoid merge issues and ignore files in diffs
*.json -diff merge=ours linguist-generated
*.jsonl -diff merge=ours linguist-generated        
*.js -diff merge=ours linguist-generated
`
        )
        // add .gitignore
        await writeFile(
            dir,
            ".gitignore",
            `# ignore local cli
genaiscript.cjs
cache/
retrieval/
`
        )
    }

    aiRequestCache() {
        return this._aiRequestCache
    }

    async retryAIRequest(): Promise<void> {
        const options = this.aiRequest?.options
        await this.cancelAiRequest()
        if (options) {
            await delay(100 + Math.random() * 1000)
            await this.requestAI(options)
        }
    }

    async applyEdits() {
        const req = this.aiRequest
        if (!req) return
        const edits = req.response?.edits
        if (!edits) return

        req.editsApplied = null
        this.dispatchChange()

        const applied = await applyEdits(edits, {
            needsConfirmation: true,
        })

        req.editsApplied = applied
        if (req !== this.aiRequest) return
        if (req.editsApplied) saveAllTextDocuments()
        this.dispatchChange()
    }

    async requestAI(options: AIRequestOptions): Promise<void> {
        try {
            const req = await this.startAIRequest(options)
            if (!req) return
            const res = await req?.request
            const { edits, text } = res || {}
            if (text)
                vscode.commands.executeCommand(
                    "genaiscript.request.open.output"
                )

            const key = await snapshotAIRequestKey(req)
            const snapshot = snapshotAIRequest(req)
            await this._aiRequestCache.set(key, snapshot)
            this.setDiagnostics()
            this.dispatchChange()

            if (edits?.length) this.applyEdits()
        } catch (e) {
            if (isCancelError(e)) return
            else if (isTokenError(e)) {
                const trace = "Open Trace"
                const res = await vscode.window.showErrorMessage(
                    "OpenAI token refused (403).",
                    trace
                )
                if (res === trace)
                    vscode.commands.executeCommand(
                        "genaiscript.request.open.trace"
                    )
            } else if (isRequestError(e, 400, "context_length_exceeded")) {
                const help = "Documentation"
                const title = `Context length exceeded.`
                const msg = `${title}.
    ${e.message}`
                const res = await vscode.window.showWarningMessage(msg, help)
                if (res === help)
                    vscode.env.openExternal(
                        vscode.Uri.parse(CONTEXT_LENGTH_DOCUMENTATION_URL)
                    )
            } else if (isRequestError(e, 400)) {
                const help = "Documentation"
                const msg = `OpenAI model error (400).
${e.message}`
                const res = await vscode.window.showWarningMessage(msg, help)
                if (res === help)
                    vscode.env.openExternal(
                        vscode.Uri.parse(TOKEN_DOCUMENTATION_URL)
                    )
            } else if (isRequestError(e)) {
                const msg = isRequestError(e, 404)
                    ? `OpenAI model not found (404). Does your token support the selected model?`
                    : e.message
                await vscode.window.showWarningMessage(msg)
            } else throw e
        }
    }

    readonly requestHistory: {
        filename: string
        template: string
    }[] = []

    private async startAIRequest(
        options: AIRequestOptions
    ): Promise<AIRequest> {
        const controller = new AbortController()
        const config = vscode.workspace.getConfiguration(TOOL_ID)
        const maxCachedTemperature: number = config.get("maxCachedTemperature")
        const maxCachedTopP: number = config.get("maxCachedTopP")
        const signal = controller.signal
        const cancellationToken = new AbortSignalCancellationToken(signal)
        const trace = new MarkdownTrace()

        const r: AIRequest = {
            creationTime: new Date().toISOString(),
            options,
            controller,
            request: null,
            computing: true,
            editsApplied: undefined,
            trace,
        }
        const reqChange = () => {
            if (this._aiRequest === r) {
                this.dispatchEvent(new Event(AI_REQUEST_CHANGE))
                this.setDiagnostics()
                this.dispatchChange()
            }
        }
        trace.addEventListener(CHANGE, reqChange)
        const partialCb = (progress: ChatCompletionsProgressReport) => {
            r.progress = progress
            if (r.response) {
                r.response.text = progress.responseSoFar
                if (/\n/.test(progress.responseChunk))
                    r.response.annotations = parseAnnotations(r.response.text)
            }
            reqChange()
        }
        this.aiRequest = r
        const { template, fragment } = options
        const runOptions: RunTemplateOptions = {
            requestOptions: { signal },
            cancellationToken,
            partialCb,
            trace,
            infoCb: (data) => {
                r.response = data
                reqChange()
            },
            maxCachedTemperature,
            maxCachedTopP,
            cache: true,
            retry: 3,
            cliInfo: {
                spec: vscode.workspace.asRelativePath(
                    this.host.isVirtualFile(fragment.file.filename)
                        ? fragment.file.filename.replace(/\.gpspec\.md$/i, "")
                        : fragment.file.filename
                ),
            },
        }

        const hasToken = !!(await this.host.getSecretToken(template))
        if (!hasToken) {
            // we don't have a token so ask user if they want to use copilot
            const lmmodel = await pickLanguageModel(this)
            if (lmmodel) {
                configureLanguageModelAccess(
                    this.context,
                    options,
                    runOptions,
                    lmmodel
                )
            } else return undefined
        }

        this.requestHistory.push({
            template: template.id,
            filename: fragment.file.filename,
        })
        if (this.requestHistory.length > MAX_HISTORY_LENGTH)
            this.requestHistory.shift()

        r.request = runTemplate(template, fragment, runOptions)
        vscode.commands.executeCommand("genaiscript.request.open.output")
        r.request
            .then((resp) => {
                r.response = resp
                r.computing = false
                if (resp.error) r.error = resp.error
            })
            .catch((e) => {
                r.computing = false
                r.error = e
            })
            .then(reqChange)
        return r
    }

    get parsing() {
        return !!this._parseWorkspacePromise
    }

    get aiRequest() {
        return this._aiRequest
    }

    private set aiRequest(r: AIRequest) {
        if (this._aiRequest !== r) {
            this._aiRequest = r
            this.dispatchEvent(new Event(AI_REQUEST_CHANGE))
            this.dispatchChange()
        }
    }

    async cancelAiRequest() {
        const a = this.aiRequest
        if (a && a.computing && !a?.controller?.signal?.aborted) {
            a.controller?.abort("user cancelled")
            this.host.server.client.cancel()
            this.dispatchChange()
            await delay(100)
        }
    }

    get project() {
        return this._project
    }

    get rootFragments() {
        return this._project
            ? concatArrays(...this._project.rootFiles.map((p) => p.fragments))
            : []
    }

    private async setProject(prj: Project) {
        this._project = prj
        await this.fixPromptDefinitions()
        this.dispatchFragments()
    }

    private dispatchChange() {
        this.dispatchEvent(new Event(CHANGE))
    }

    private dispatchFragments(fragments?: Fragment[]) {
        this.dispatchEvent(new FragmentsEvent(fragments))
        this.dispatchChange()
    }

    async activate() {
        await this.saveScripts()
        await this.fixPromptDefinitions()
        await this.parseWorkspace()

        logInfo("genaiscript extension activated")
    }

    async fixPromptDefinitions() {
        const prompts = await vscode.workspace.findFiles("**/*" + GENAI_EXT)
        const folders = new Set(prompts.map((f) => Utils.dirname(f).fsPath))
        for (const folder of folders) {
            const f = vscode.Uri.file(folder)
            for (let [defName, defContent] of Object.entries(
                promptDefinitions
            )) {
                if (this.project && defName === "genaiscript.d.ts") {
                    const systems = this.project.templates
                        .filter((t) => t.isSystem)
                        .map((s) => `"${s.id}"`)
                    defContent = defContent.replace(
                        "type SystemPromptId = string",
                        `type SystemPromptId = ${systems.join(" | ")}`
                    )
                }
                const current = await readFileText(f, defName)
                if (current !== defContent)
                    await writeFile(f, defName, defContent)
            }
        }
    }

    async findScripts() {
        const scriptFiles = await findFiles("**/*" + GENAI_EXT)
        return scriptFiles
    }

    async parseWorkspace() {
        if (this._parseWorkspacePromise) return this._parseWorkspacePromise

        const parser = async () => {
            try {
                this.dispatchChange()
                performance.mark(`save-docs`)
                await saveAllTextDocuments()
                performance.mark(`project-start`)
                const gpspecFiles = await findFiles("**/*.gpspec.md")
                performance.mark(`scan-tools`)
                const scriptFiles = await this.findScripts()
                performance.mark(`parse-project`)
                const newProject = await parseProject({
                    gpspecFiles,
                    scriptFiles,
                })
                await this.setProject(newProject)
                this.setDiagnostics()
                logMeasure(`project`, `project-start`, `project-end`)
            } finally {
                this._parseWorkspacePromise = undefined
                this.dispatchChange()
            }
        }

        this._parseWorkspacePromise = parser()
        this.dispatchChange()
        await this._parseWorkspacePromise
    }

    async parseDirectory(uri: vscode.Uri, token?: vscode.CancellationToken) {
        const fspath = uri.fsPath
        const specn = fspath + "/dir.gpspec.md"
        const files = (await listFiles(uri)).filter(
            (uri) => !uri.fsPath.endsWith(".gpspec.md")
        )
        if (token?.isCancellationRequested) return undefined

        const spec = `# Specification

${files
    .map((uri) => this.host.path.relative(fspath, uri.fsPath))
    .map((fn) => `-   [${fn}](./${fn})`)
    .join("\n")}
`
        this.host.clearVirtualFiles()
        this.host.setVirtualFile(specn, spec)

        const gpspecFiles = [specn]
        const scriptFiles = await this.findScripts()
        if (token?.isCancellationRequested) return undefined

        const newProject = await parseProject({
            gpspecFiles,
            scriptFiles,
        })
        return newProject
    }

    async parseDocument(
        document: vscode.Uri,
        token?: vscode.CancellationToken
    ) {
        const fspath = document.fsPath
        const fn = Utils.basename(document)
        const specn = fspath + ".gpspec.md"
        this.host.clearVirtualFiles()
        this.host.setVirtualFile(
            specn,
            `# Specification

-   [${fn}](./${fn})
`
        )
        const gpspecFiles = [specn]
        const scriptFiles = await this.findScripts()
        if (token?.isCancellationRequested) return undefined

        const newProject = await parseProject({
            gpspecFiles,
            scriptFiles,
        })
        return newProject
    }

    private setDiagnostics() {
        let diagnostics = this.project.diagnostics
        if (this._aiRequest?.response?.annotations?.length)
            diagnostics = diagnostics.concat(
                this._aiRequest?.response?.annotations
            )
        this._diagColl.clear()
        // project entries
        const severities: Record<
            DiagnosticSeverity | "notice",
            vscode.DiagnosticSeverity
        > = {
            notice: vscode.DiagnosticSeverity.Information,
            warning: vscode.DiagnosticSeverity.Warning,
            error: vscode.DiagnosticSeverity.Error,
            info: vscode.DiagnosticSeverity.Information,
        }
        for (const [filename, diags] of Object.entries(
            groupBy(diagnostics, (d) => d.filename)
        )) {
            const ds = diags.map((d) => {
                let message = d.message
                let value: string
                let target: vscode.Uri
                const murl = /\[([^\]]+)\]\((https:\/\/([^)]+))\)/.exec(message)
                if (murl) {
                    value = murl[1]
                    target = vscode.Uri.parse(murl[2])
                }
                const r = new vscode.Diagnostic(
                    toRange(d.range),
                    message || "...",
                    severities[d.severity]
                )
                r.source = TOOL_NAME
                r.code = target
                    ? {
                          value,
                          target,
                      }
                    : undefined
                return r
            })
            const uri = vscode.Uri.file(filename)
            this._diagColl.set(uri, ds)
        }
    }

    private clear() {
        this.dispatchChange()
    }

    dispose() {
        this.clear()
    }
}
