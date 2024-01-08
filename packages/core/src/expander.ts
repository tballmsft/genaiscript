import {
    ChatCompletionRequestMessage,
    ChatCompletionResponse,
    ChatCompletionsOptions,
    CreateChatCompletionRequest,
    RequestError,
    getChatCompletions,
} from "./chat"
import { Diagnostic, Fragment, PromptTemplate, allChildren } from "./ast"
import { commentAttributes, stringToPos } from "./parser"
import { assert, fileExists, logVerbose, readText, relativePath } from "./util"
import {
    evalPrompt,
    extractFenced,
    renderFencedVariables,
    staticVars,
} from "./template"
import { host } from "./host"
import { inspect } from "./logging"
import { applyLLMDiff, applyLLMPatch, parseLLMDiffs } from "./diff"
import { defaultUrlAdapters } from "./urlAdapters"
import { MarkdownTrace } from "./trace"
import { JSON5TryParse } from "./json5"

const defaultModel = "gpt-4"
const defaultTemperature = 0.2 // 0.0-2.0, defaults to 1.0
const defaultSeed: number = undefined
const defaultMaxTokens: number = undefined

export interface FragmentTransformResponse {
    /**
     * The env variables sent to the prompt
     */
    vars: Partial<ExpansionVariables>

    /**
     * Expanded prompt text
     */
    prompt: {
        system: string
        user: string
    }
    /**
     * Zero or more edits to apply.
     */
    edits: Edits[]

    /**
     * Parsed source annotations
     */
    annotations: Diagnostic[]

    /**
     * A map of file updates
     */
    fileEdits: Record<string, { before: string; after: string }>

    /**
     * MD-formatted trace.
     */
    trace: string

    /**
     * LLM output.
     */
    text: string

    /**
     * Summary of the output generated by the LLM
     */
    summary?: string

    /**
     * Error message if any
     */
    error?: unknown

    /**
     * Run label if provided
     */
    label?: string
}

function trimNewlines(s: string) {
    return s.replace(/^\n*/, "").replace(/\n*$/, "")
}
const fence = "```"
const markdownFence = "``````"
const systemFence = "---"

export function fenceMD(t: string, contentType?: string) {
    if (!contentType) contentType = "markdown"
    const f = contentType === "markdown" ? markdownFence : fence
    return `\n${f}${contentType}\n${trimNewlines(t)}\n${f}\n`
}

async function callExpander(
    r: PromptTemplate,
    vars: ExpansionVariables,
    trace: MarkdownTrace
) {
    let promptText = ""
    let success = true
    const env = new Proxy(vars, {
        get: (target: any, prop, recv) => {
            const v = target[prop]
            if (v === undefined) {
                trace.error(`\`env.${String(prop)}\` not defined`)
                return ""
            }
            return v
        },
    })
    let logs = ""
    try {
        await evalPrompt(
            {
                env,
                writeText: (body) => {
                    promptText +=
                        body.replace(/\n*$/, "").replace(/^\n*/, "") + "\n\n"

                    const idx = body.indexOf(vars.error)
                    if (idx >= 0) {
                        const msg = body
                            .slice(idx + vars.error.length)
                            .replace(/\n[^]*/, "")
                        throw new Error(msg)
                    }
                },
                gptool: () => {},
                system: () => {},
                fetchText: async (urlOrFile) => {
                    if (typeof urlOrFile === "string") {
                        urlOrFile = {
                            label: urlOrFile,
                            filename: urlOrFile,
                            content: "",
                        }
                    }
                    const url = urlOrFile.filename
                    let ok = false
                    let status = 404
                    let text: string
                    if (/^https?:\/\//i.test(url)) {
                        const resp = await fetch(url)
                        ok = resp.ok
                        status = resp.status
                        if (ok) text = await resp.text()
                    } else {
                        try {
                            text = await readText("workspace://" + url)
                            ok = true
                        } catch (e) {
                            logVerbose(e)
                            ok = false
                            status = 404
                        }
                    }
                    const file: LinkedFile = {
                        label: urlOrFile.label,
                        filename: urlOrFile.label,
                        content: text,
                    }
                    return {
                        ok,
                        status,
                        text,
                        file,
                    }
                },
            },
            r.jsSource,
            (msg) => {
                logs += msg + "\n"
            }
        )
    } catch (e) {
        success = false
        const m = /at eval.*<anonymous>:(\d+):(\d+)/.exec(e.stack)
        const info = m ? ` at prompt line ${m[1]}, column ${m[2]}` : ""
        trace.error(info, e)
    }
    return { logs, success, text: promptText }
}

async function expandTemplate(
    template: PromptTemplate,
    fragment: Fragment,
    options: {
        temperature?: number
        model?: string
        seed?: number
        max_tokens?: number
    },
    env: ExpansionVariables,
    trace: MarkdownTrace
) {
    const varName: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) {
        if (!varName[v]) varName[v] = k
    }
    const varMap = env as any as Record<string, string | any[]>

    const prompt = await callExpander(template, env, trace)
    const expanded = prompt.text

    // always append, even if empty - should help with discoverability:
    // "Oh, so I can console.log() from prompt!"
    trace.startDetails("console output")
    if (prompt.logs?.length) trace.fence(prompt.logs)
    else trace.tip("use `console.log()` from gptool.js files`")
    trace.endDetails()

    traceVars()

    let systemText = ""
    let model = template.model
    let temperature = template.temperature
    let max_tokens = template.maxTokens
    let seed = template.seed
    let responseType = template.responseType

    trace.startDetails(`system gptools`)

    const systems = (template.system ?? []).slice(0)
    if (!systems.length) {
        systems.push("system")
        systems.push("system.explanations")
        systems.push("system.files")
        systems.push("system.summary")
    }
    for (let i = 0; i < systems.length; ++i) {
        let systemTemplate = systems[i]
        let system = fragment.file.project.getTemplate(systemTemplate)
        if (!system) {
            if (systemTemplate) trace.error(`\`${systemTemplate}\` not found\n`)
            if (i > 0) continue
            systemTemplate = "system"
            system = fragment.file.project.getTemplate(systemTemplate)
            assert(!!system)
        }

        const sysex = (await callExpander(system, env, trace)).text
        systemText += systemFence + "\n" + sysex + "\n"

        model = model ?? system.model
        temperature = temperature ?? system.temperature
        max_tokens = max_tokens ?? system.maxTokens
        seed = seed ?? system.seed
        responseType = responseType ?? system.responseType

        trace.heading(3, `\`${systemTemplate}\` source`)
        if (system.model) trace.item(`model: \`${system.model || ""}\``)
        if (system.temperature !== undefined)
            trace.item(`temperature: ${system.temperature || ""}`)
        if (system.maxTokens !== undefined)
            trace.item(`max tokens: ${system.maxTokens || ""}`)

        trace.fence(system.jsSource, "js")
        trace.heading(4, "expanded")
        trace.fence(sysex, "markdown")
    }
    trace.endDetails()

    trace.detailsFenced("gptool source", template.jsSource, "js")

    model = (options.model ??
        env.vars["model"] ??
        model ??
        fragment.project.coarchJson.model ??
        defaultModel) as any
    temperature =
        options.temperature ??
        tryParseFloat(env.vars["temperature"]) ??
        temperature ??
        defaultTemperature
    max_tokens =
        options.max_tokens ??
        tryParseInt(env.vars["maxTokens"]) ??
        max_tokens ??
        defaultMaxTokens
    seed = options.seed ?? tryParseInt(env.vars["seed"]) ?? seed ?? defaultSeed

    trace.startDetails("gptool expanded prompt")
    if (model) trace.item(`model: \`${model || ""}\``)
    if (temperature !== undefined)
        trace.item(`temperature: ${temperature || ""}`)
    if (max_tokens !== undefined) trace.item(`max tokens: ${max_tokens || ""}`)
    if (seed !== undefined) {
        seed = seed >> 0
        trace.item(`seed: ${seed}`)
    }
    if (responseType) trace.item(`response type: ${responseType}`)
    trace.fence(expanded, "markdown")

    trace.endDetails()

    return {
        expanded,
        trace,
        success: prompt.success,
        model,
        temperature,
        max_tokens,
        seed,
        systemText,
        responseType,
    }

    function tryParseInt(v: string) {
        const i = parseInt(v)
        return isNaN(i) ? undefined : i
    }

    function tryParseFloat(v: string) {
        const i = parseFloat(v)
        return isNaN(i) ? undefined : i
    }

    function isComplex(k: string) {
        const v = varMap[k]
        if (typeof v === "string" && varName[v] != k) return false
        return (
            typeof v !== "string" ||
            v.length > 40 ||
            v.trim().includes("\n") ||
            v.includes("`")
        )
    }

    function traceVars() {
        trace.startDetails("variables")
        trace.tip("Variables are referenced through `env.NAME` in prompts.")

        for (const k of Object.keys(env)) {
            if (isComplex(k)) continue
            const v = varMap[k]
            if (typeof v === "string" && varName[v] != k)
                trace.item(`env.**${k}**: same as **${varName[v]}**`)
            else trace.item(`env.**${k}**: \`${v}\``)
        }

        for (const k of Object.keys(env)) {
            if (!isComplex(k)) continue
            const v = varMap[k]
            trace.item(`-   env.**${k}**`)
            trace.fence(
                typeof v === "string" ? v : inspect(v),
                typeof v === "string" ? undefined : "js"
            )
        }
        trace.endDetails()
    }
}

async function fragmentVars(
    template: PromptTemplate,
    frag: Fragment,
    promptOptions: any
) {
    const { file } = frag
    const project = file.project
    const prjFolder = host.projectFolder()
    let trace = ""

    const links: LinkedFile[] = []
    for (const fr of allChildren(frag, true)) {
        for (const ref of fr.references) {
            // what about URLs?
            if (/^https:\/\//.test(ref.filename)) {
                if (!links.find((lk) => lk.filename === ref.filename)) {
                    let content: string = ""
                    try {
                        const urlAdapters = defaultUrlAdapters.concat(
                            template.urlAdapters ?? []
                        )
                        let url = ref.filename
                        let adapter: UrlAdapter = undefined
                        for (const a of urlAdapters) {
                            const newUrl = a.matcher(url)
                            if (newUrl) {
                                url = newUrl
                                adapter = a
                                break
                            }
                        }
                        trace += `fetch ${url}\n`
                        const resp = await fetch(url, {
                            headers: {
                                "Content-Type":
                                    adapter?.contentType ?? "text/plain",
                            },
                        })
                        if (resp.ok)
                            content =
                                adapter?.contentType === "application/json"
                                    ? adapter.adapter(await resp.json())
                                    : await resp.text()
                    } catch (e) {
                        trace += `fetch failed for ${ref.filename}\n`
                        trace += e.message + "\n"
                    }
                    links.push({
                        label: ref.name,
                        filename: ref.filename,
                        content,
                    })
                }
                continue
            }

            // check for existing file
            const projectFile = project.allFiles.find(
                (f) => f.filename === ref.filename
            )
            if (!projectFile) {
                trace += `reference ${ref.filename} not found\n`
                continue
            }

            const fn = relativePath(host.projectFolder(), projectFile.filename)
            if (!links.find((lk) => lk.filename === fn))
                links.push({
                    label: ref.name,
                    filename: fn,
                    content: projectFile.content,
                })
        }
    }
    const parents: LinkedFile[] = []
    if (frag.parent)
        parents.push({
            label: frag.parent.title,
            filename: relativePath(prjFolder, frag.parent.file.filename),
            content: frag.parent.file.content,
        })
    const attrs = commentAttributes(frag)

    const vars: Partial<ExpansionVariables> = {
        ...staticVars(),
        file: {
            filename: relativePath(host.projectFolder(), file.filename),
            label: "current",
            content: file.content,
        },
        links,
        parents,
        promptOptions,
        template: {
            id: template.id,
            title: template.title,
            description: template.description,
        },
        vars: attrs,
    }
    return { vars, trace }
}

export type RunTemplateOptions = ChatCompletionsOptions & {
    infoCb?: (partialResponse: Partial<FragmentTransformResponse>) => void
    promptOptions?: any
    maxCachedTemperature?: number
    skipLLM?: boolean
    label?: string
    temperature?: number
    seed?: number
    model?: string
    cache?: boolean
    cliInfo?: {
        spec: string
    }
    chat?: ChatAgentContext
    getChatCompletions?: (
        req: CreateChatCompletionRequest,
        options?: ChatCompletionsOptions & { trace: MarkdownTrace }
    ) => Promise<ChatCompletionResponse>
}

export function generateCliArguments(
    template: PromptTemplate,
    fragment: Fragment,
    options: RunTemplateOptions
) {
    const { model, temperature, seed, cliInfo } = options

    const cli = [
        "node",
        ".gptools/gptools.js",
        "run",
        template.id,
        cliInfo.spec,
        "--apply-edits",
    ]
    if (model) cli.push(`--model`, model)
    if (!isNaN(temperature)) cli.push(`--temperature`, temperature + "")
    if (!isNaN(seed)) cli.push("--seed", seed + "")

    return cli.join(" ")
}

export async function runTemplate(
    template: PromptTemplate,
    fragment: Fragment,
    options: RunTemplateOptions
): Promise<FragmentTransformResponse> {
    const { requestOptions = {}, skipLLM, label, cliInfo } = options || {}
    const { signal } = requestOptions

    options.infoCb?.({ trace: "", text: "Preparing..." })

    const trace = new MarkdownTrace()
    trace.heading(2, label || template.id)

    if (cliInfo) traceCliArgs(trace, template, fragment, options)

    const { vars, trace: varsTrace } = await fragmentVars(
        template,
        fragment,
        options.promptOptions
    )
    vars.chat = options.chat || { history: [], prompt: "" }

    if (varsTrace) trace.details("variables", varsTrace)

    let {
        expanded,
        success,
        temperature,
        model,
        max_tokens,
        seed,
        systemText,
        responseType,
    } = await expandTemplate(
        template,
        fragment,
        options,
        vars as ExpansionVariables,
        trace
    )

    const prompt = {
        system: systemText,
        user: expanded,
    }

    // if the expansion failed, show the user the trace
    if (!success) {
        return {
            error: new Error("Template failed"),
            prompt,
            vars,
            trace: trace.content,
            text: "# Template failed\nSee trace.",
            edits: [],
            annotations: [],
            fileEdits: {},
            label,
        }
    }

    // don't run LLM
    if (skipLLM) {
        return {
            prompt,
            vars,
            trace: trace.content,
            text: undefined,
            edits: [],
            annotations: [],
            fileEdits: {},
            label,
        }
    }
    const response_format = responseType ? { type: responseType } : undefined
    const completer = options.getChatCompletions || getChatCompletions

    // initial messages (before tools)
    const messages: ChatCompletionRequestMessage[] = [
        {
            role: "system",
            content: systemText,
        },
        {
            role: "user",
            content: expanded,
        },
    ]

    const status = (text: string) => {
        statusText += `\n\n${text}...`
        options.infoCb?.({
            vars,
            text: statusText,
            label,
        })
    }

    let statusText = ""
    let text: string
    while (!signal?.aborted) {
        let resp: ChatCompletionResponse
        try {
            try {
                status(`calling LLM`)
                trace.startDetails(`llm request (${messages.length} messages)`)
                resp = await completer(
                    {
                        model,
                        temperature,
                        max_tokens,
                        seed,
                        messages,
                        stream: true,
                        response_format,
                        tools: vars.functions?.map((f) => ({
                            type: "function",
                            function: f.definition,
                        })),
                    },
                    { ...options, trace }
                )
            } finally {
                trace.endDetails()
            }
        } catch (error: unknown) {
            if (error instanceof RequestError) {
                trace.heading(3, `Request error`)
                if (error.body) {
                    trace.log(`> ${error.body.message}\n\n`)
                    trace.item(`type: \`${error.body.type}\``)
                    trace.item(`code: \`${error.body.code}\``)
                }
                trace.item(`status: \`${error.status}\`, ${error.statusText}`)
                resp = {
                    text: `Request error: \`${error.status}\`, ${error.statusText}\n`,
                }
            } else if (signal?.aborted) {
                trace.heading(3, `Request cancelled`)
                trace.log(`The user requested to cancel the request.`)
                resp = { text: "Request cancelled" }
                error = undefined
            } else {
                trace.heading(3, `Fetch error`)
                trace.error(error + "")
                resp = { text: "Unexpected error" }
            }

            return {
                prompt,
                vars,
                trace: trace.content,
                error,
                text: resp?.text,
                edits: [],
                annotations: [],
                fileEdits: {},
                label,
            }
        }

        if (resp.text) trace.detailsFenced("llm response", resp.text)

        if (resp.toolCalls?.length) {
            status(`running tools`)
            options.infoCb?.({
                vars,
                text: statusText,
                label,
            })

            if (resp.text)
                messages.push({
                    role: "assistant",
                    content: resp.text,
                })
            messages.push({
                role: "assistant",
                content: null,
                tool_calls: resp.toolCalls.map((c) => ({
                    id: c.id,
                    function: {
                        name: c.name,
                        arguments: c.arguments,
                    },
                    type: "function",
                })),
            })

            // call tool and run again
            for (const call of resp.toolCalls) {
                if (signal?.aborted) break
                try {
                    trace.startDetails(`tool call ${call.name}`)
                    trace.item(`id: \`${call.id}\``)
                    trace.item(`args:`)
                    trace.fence(call.arguments, "json")
                    const args = call.arguments
                        ? JSON.parse(call.arguments)
                        : undefined
                    const fd = vars.functions.find(
                        (f) => f.definition.name === call.name
                    )
                    if (!fd) throw new Error(`function ${call.name} not found`)

                    const host: ChatFunctionCallHost = {
                        findFiles: async (glob) => host.findFiles(glob),
                        readText: async (file) => host.readText(file),
                    }
                    const context: ChatFunctionCallContext = {
                        trace,
                        host,
                    }

                    let output = await fd.fn({ context, ...args })
                    if (typeof output === "string") output = { content: output }
                    const { content, edits } = output

                    if (content) trace.fence(content, "markdown")
                    if (edits?.length) trace.fence(edits, "json")

                    messages.push({
                        role: "tool",
                        content,
                        tool_call_id: call.id,
                    })
                } catch (e) {
                    trace.error(`function failed`, e)
                    throw e
                } finally {
                    trace.endDetails()
                }
            }
        } else {
            text =
                messages.filter((msg) => msg.role === "assistant").join("\n") +
                resp.text
            break
        }
    }

    const json = JSON5TryParse(text, undefined)
    const fences = json === undefined ? extractFenced(text) : []
    if (fences?.length)
        trace.details("code regions", renderFencedVariables(fences))
    if (json !== undefined) {
        trace.startDetails("json (parsed)")
        trace.fence(JSON.stringify(json, null, 2), "json")
        trace.endDetails()
    }

    const fileEdits: Record<string, { before: string; after: string }> = {}
    const annotations: Diagnostic[] = []
    const edits: Edits[] = []
    let summary: string = undefined

    const projFolder = host.projectFolder()
    const links: string[] = []
    const fp = fragment.file.filename
    const fragn = /^.\//.test(fp)
        ? host.resolvePath(projFolder, fragment.file.filename)
        : fp
    const ff = host.resolvePath(fp, "..")
    const refs = fragment.references
    const fragmentVirtual = await fileExists(fragment.file.filename, {
        virtual: true,
    })

    const getFileEdit = async (fn: string) => {
        let fileEdit = fileEdits[fn]
        if (!fileEdit) {
            let before: string = null
            let after: string = undefined
            if (await fileExists(fn, { virtual: false }))
                before = await readText(fn)
            else if (await fileExists(fn, { virtual: true }))
                after = await readText(fn)
            fileEdit = fileEdits[fn] = { before, after }
        }
        return fileEdit
    }

    if (json !== undefined) {
        const fn = fragment.file.filename.replace(
            /\.gpspec\.md$/i,
            "." + template.id + ".json"
        )
        const fileEdit = await getFileEdit(fn)
        fileEdit.after = text
    } else {
        for (const fence of fences) {
            const { label: name, content: val } = fence
            const pm = /^((file|diff):?)\s+/i.exec(name)
            if (pm) {
                const kw = pm[1].toLowerCase()
                const n = name.slice(pm[0].length).trim()
                const fn = /^[^\/]/.test(n)
                    ? host.resolvePath(projFolder, n)
                    : n
                const ffn = relativePath(ff, fn)
                const curr = refs.find((r) => r.filename === fn)?.filename

                const fileEdit = await getFileEdit(fn)
                if (kw === "file") {
                    if (template.fileMerge) {
                        try {
                            fileEdit.after =
                                template.fileMerge(
                                    label,
                                    fileEdit.after ?? fileEdit.before,
                                    val
                                ) ?? val
                        } catch (e) {
                            logVerbose(e)
                            trace.error(`error custom merging diff in ${fn}`, e)
                        }
                    } else fileEdit.after = val
                } else if (kw === "diff") {
                    const chunks = parseLLMDiffs(val)
                    try {
                        fileEdit.after = applyLLMPatch(
                            fileEdit.after || fileEdit.before,
                            chunks
                        )
                    } catch (e) {
                        logVerbose(e)
                        trace.error(`error applying patch to ${fn}`, e)
                        try {
                            fileEdit.after = applyLLMDiff(
                                fileEdit.after || fileEdit.before,
                                chunks
                            )
                        } catch (e) {
                            logVerbose(e)
                            trace.error(`error merging diff in ${fn}`, e)
                        }
                    }
                }
                if (!curr && fragn !== fn) links.push(`-   [${ffn}](${ffn})`)
            } else if (/^annotation$/i.test(name)) {
                // ::(notice|warning|error) file=<filename>,line=<start line>::<message>
                const rx =
                    /^::(notice|warning|error)\s*file=([^,]+),\s*line=(\d+),\s*endLine=(\d+)\s*::(.*)$/gim
                val.replace(rx, (_, severity, file, line, endLine, message) => {
                    const filename = /^[^\/]/.test(file)
                        ? host.resolvePath(projFolder, file)
                        : file
                    const annotation: Diagnostic = {
                        severity,
                        filename,
                        range: [
                            [parseInt(line) - 1, 0],
                            [parseInt(endLine) - 1, Number.MAX_VALUE],
                        ],
                        message,
                    }
                    annotations.push(annotation)
                    return ""
                })
            } else if (/^summary$/i.test(name)) {
                summary = val
            }
        }
    }

    // convert file edits into edits
    Object.entries(fileEdits)
        .filter(([, { before, after }]) => before !== after) // ignore unchanged files
        .forEach(([fn, { before, after }]) => {
            if (before) {
                edits.push({
                    label: `Update ${fn}`,
                    filename: fn,
                    type: "replace",
                    range: [[0, 0], stringToPos(after)],
                    text: after,
                })
            } else {
                edits.push({
                    label: `Create ${fn}`,
                    filename: fn,
                    type: "createfile",
                    text: after,
                    overwrite: true,
                })
            }
        })

    // add links to the end of the file
    if (
        links.length &&
        (!fragmentVirtual || fileEdits[fragment.file.filename]?.after)
    ) {
        const obj = {
            label: template.title,
            filename: fragment.file.filename,
        }
        edits.push({
            ...obj,
            type: "insert",
            pos: fragment.endPos,
            text: `\n${links.join("\n")}`,
        })
    }

    if (edits.length)
        trace.details(
            "edits",
            `| Type | Filename | Message |\n| --- | --- | --- |\n` +
                edits
                    .map((e) => `| ${e.type} | ${e.filename} | ${e.label} |`)
                    .join("\n")
        )
    if (annotations.length)
        trace.details(
            "annotations",
            `| Severity | Filename | Line | Message |\n| --- | --- | --- | --- |\n` +
                annotations
                    .map(
                        (e) =>
                            `| ${e.severity} | ${e.filename} | ${e.range[0]} | ${e.message} |`
                    )
                    .join("\n")
        )

    const res: FragmentTransformResponse = {
        prompt,
        vars,
        edits,
        annotations,
        fileEdits,
        trace: trace.content,
        text,
        summary,
    }
    options?.infoCb?.(res)
    return res
}

function traceCliArgs(
    trace: MarkdownTrace,
    template: globalThis.PromptTemplate,
    fragment: Fragment,
    options: RunTemplateOptions
) {
    trace.details(
        "automation",
        `This operation can be run from the command line:

\`\`\`bash
${generateCliArguments(template, fragment, options)}
\`\`\`

-   You will need to install [Node.js](https://nodejs.org/en/).
-   Configure the OpenAI token in environment variables (run \`node .gptools/gptools help keys\` for help).
-   The \`.gptools/gptools.js\` is written by the Visual Studio Code extension automatically.
-   Run \`node .gptools/gptools help run\` for the full list of options.
`
    )
}
