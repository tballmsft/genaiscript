interface PromptDefinition {
    /**
     * Based on file name.
     */
    id: string

    /**
     * Something like "Summarize children", show in UI.
     */
    title: string

    /**
     * Longer description of the prompt. Shows in UI grayed-out.
     */
    description?: string
}

interface PromptLike extends PromptDefinition {
    /**
     * File where the prompt comes from (if any).
     */
    filename?: string

    /**
     * The text of the prompt JS source code.
     */
    jsSource: string

    /**
     * The actual text of the prompt template.
     * Only used for system prompts.
     */
    text: string
}

type SystemPromptId = "system.diff" | "system.annotations" | "system.explanations" | "system.fs_find_files" | "system.fs_read_file" | "system.files" | "system.changelog" | "system.json" | "system" | "system.python" | "system.summary" | "system.tasks" | "system.schema" | "system.technical" | "system.typescript" | "system.functions"

interface UrlAdapter {
    contentType?: "text/plain" | "application/json"

    /**
     * Given a friendly URL, return a URL that can be used to fetch the content.
     * @param url
     * @returns
     */
    matcher: (url: string) => string

    /**
     * Convers the body of the response to a string.
     * @param body
     * @returns
     */
    adapter?: (body: string | any) => string | undefined
}

type PromptTemplateResponseType = "json_object" | undefined

interface PromptTemplate extends PromptLike {
    /**
     * Which LLM model to use.
     *
     * @default gpt-4
     * @example gpt-4 gpt-4-32k gpt-3.5-turbo
     */
    model?: "gpt-4" | "gpt-4-32k" | "gpt-3.5-turbo" | string

    /**
     * Temperature to use. Higher temperature means more hallucination/creativity.
     * Range 0.0-2.0.
     *
     * @default 0.2
     */
    temperature?: number

    /**
     * “Top_p” or nucleus sampling is a setting that decides how many possible words to consider.
     * A high “top_p” value means the model looks at more possible words, even the less likely ones,
     * which makes the generated text more diverse.
     */
    topP?: number

    /**
     * When to stop producing output.
     *
     */
    maxTokens?: number

    /**
     * A deterministic integer seed to use for the model.
     */
    seed?: number

    /**
     * If this is `["a", "b.c"]` then the prompt will include values of variables:
     * `@prompt`, `@prompt.a`, `@prompt.b`, `@prompt.b.c`
     * TODO implement this
     *
     * @example ["summarize"]
     * @example ["code.ts.node"]
     */
    categories?: string[]

    /**
     * Don't show it to the user in lists. Template `system.*` are automatically unlisted.
     */
    unlisted?: boolean

    /**
     * Set if this is a system prompt.
     */
    isSystem?: boolean

    /**
     * Template identifiers for the system prompts (concatenated).
     */
    system?: SystemPromptId[]

    /**
     * File extension this prompt applies to; if present. Defaults to `.md`.
     */
    input?: string

    /**
     * Specifies a folder to create output files into
     */
    outputFolder?: string

    /**
     * Specifies the type of output. Default is `markdown`.
     */
    responseType?: PromptTemplateResponseType

    /**
     * A set of custom merge strategies.
     * @param before previous file content if any
     * @param generated string generated by the LLM
     * @returns undefined to ignore merge, or a string to use as the new content
     */
    fileMerge?: (label: string, before: string, generated: string) => string

    /**
     * Given a user friendly URL, return a URL that can be used to fetch the content. Returns undefined if unknown.
     */
    urlAdapters?: UrlAdapter[]

    /**
     * Indicate if the tool can be used in a copilot chat context. `true` is exclusive, `false` never and `undefined` is both.
     */
    chat?: boolean

    /**
     * Indicates what output should be included in the chat response.
     */
    chatOutput?: "inline" | "summary"

    /**
     * If running in chat, use copilot LLM model
     */
    copilot?: boolean
}

/**
 * Represent a file linked from a `.gpsec.md` document.
 */
interface LinkedFile {
    /**
     * If file is linked through `[foo](./path/to/file)` then this is "foo"
     */
    label: string

    /**
     * Name of the file, relative to project root.
     */
    filename: string

    /**
     * Content of the file.
     */
    content: string
}

type ChatMessageRole = "user" | "system" | "assistant" | "function"

// ChatML
interface ChatMessage {
    role: ChatMessageRole
    content: string
    name?: string
}

interface ChatAgentContext {
    /**
    /**
     * All of the chat messages so far in the current chat session.
     */
    history: ChatMessage[]

    /**
     * The prompt that was used to start the chat session.
     */
    prompt?: string
}

interface ChatFunctionDefinition {
    /**
     * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain
     * underscores and dashes, with a maximum length of 64.
     */
    name: string

    /**
     * A description of what the function does, used by the model to choose when and
     * how to call the function.
     */
    description?: string

    /**
     * The parameters the functions accepts, described as a JSON Schema object. See the
     * [guide](https://platform.openai.com/docs/guides/text-generation/function-calling)
     * for examples, and the
     * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
     * documentation about the format.
     *
     * Omitting `parameters` defines a function with an empty parameter list.
     */
    parameters?: ChatFunctionParameters
}

/**
 * The parameters the functions accepts, described as a JSON Schema object. See the
 * [guide](https://platform.openai.com/docs/guides/text-generation/function-calling)
 * for examples, and the
 * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
 * documentation about the format.
 *
 * Omitting `parameters` defines a function with an empty parameter list.
 */
type ChatFunctionParameters = JSONSchema

interface ChatFunctionCallTrace {
    log(message: string): void
    item(message: string): void
    tip(message: string): void
    fence(message: string, contentType?: string): void
}

/**
 * Position (line, character) in a file. Both are 0-based.
 */
type CharPosition = [number, number]

/**
 * Describes a run of text.
 */
type CharRange = [CharPosition, CharPosition]

/**
 * 0-based line numbers.
 */
type LineRange = [number, number]

interface FileEdit {
    type: string
    filename: string
    label?: string
}

interface ReplaceEdit extends FileEdit {
    type: "replace"
    range: CharRange | LineRange
    text: string
}

interface InsertEdit extends FileEdit {
    type: "insert"
    pos: CharPosition | number
    text: string
}

interface DeleteEdit extends FileEdit {
    type: "delete"
    range: CharRange | LineRange
}

interface CreateFileEdit extends FileEdit {
    type: "createfile"
    overwrite?: boolean
    ignoreIfExists?: boolean
    text: string
}

type Edits = InsertEdit | ReplaceEdit | DeleteEdit | CreateFileEdit

interface ChatFunctionCallContent {
    type?: "content"
    content: string
    edits?: Edits[]
}

interface ChatFunctionCallShell {
    type: "shell"
    command: string
    stdin?: string
    files?: Record<string, string>
    outputFile?: string
    cwd?: string
    args?: string[]
    timeout?: number
    ignoreExitCode?: boolean
}

type ChatFunctionCallOutput =
    | string
    | ChatFunctionCallContent
    | ChatFunctionCallShell

interface ChatFunctionCallHost {
    findFiles(glob: string): Promise<string[]>
    readText(file: string): Promise<string>
}

interface ChatFunctionCallContext {
    trace: ChatFunctionCallTrace
    host: ChatFunctionCallHost
}

interface ChatFunctionCallback {
    definition: ChatFunctionDefinition
    fn: (
        args: { context: ChatFunctionCallContext } & Record<string, any>
    ) => ChatFunctionCallOutput | Promise<ChatFunctionCallOutput>
}

/**
 * A set of text extracted from the context of the prompt execution
 */
interface ExpansionVariables {
    /**
     * Used to delimit multi-line strings, expect for markdown.
     * `fence(X)` is preferred (equivalent to `` $`${env.fence}\n${X}\n${env.fence}` ``)
     */
    fence: string

    /**
     * Used to delimit multi-line markdown strings.
     * `fence(X, { language: "markdown" })` is preferred (equivalent to `` $`${env.markdownFence}\n${X}\n${env.markdownFence}` ``)
     */
    markdownFence: string

    /**
     * Description of the context as markdown; typically the content of a .gpspec.md file.
     */
    context: LinkedFile

    /**
     * List of linked files parsed in context
     */
    files: LinkedFile[]

    /**
     * List of files pointing to this fragment
     */
    parents: LinkedFile[]

    /**
     * If the contents of this variable occurs in output, an error message will be shown to the user.
     */
    error: string

    /**
     * Prompt execution options specified in the UI
     */
    promptOptions: {
        /**
         * Ignore existing output
         */
        ignoreOutput?: boolean
    } & Record<string, string | boolean>

    /**
     * current prompt template
     */
    template: PromptDefinition

    /**
     * User defined variables
     */
    vars: Record<string, string>

    /**
     * Chat context if called from a chat command
     */
    chat?: ChatAgentContext

    /**
     * List of functions defined in the prompt
     */
    functions?: ChatFunctionCallback[]

    /**
     * List of JSON schemas; if any
     */
    schemas?: Record<string, JSONSchema>
}

type MakeOptional<T, P extends keyof T> = Partial<Pick<T, P>> & Omit<T, P>

type PromptArgs = Omit<PromptTemplate, "text" | "id" | "jsSource">

type StringLike = string | LinkedFile | LinkedFile[]

interface DefOptions {
    language?:
        | "markdown"
        | "json"
        | "yaml"
        | "javascript"
        | "typescript"
        | "python"
        | "shell"
        | string
    lineNumbers?: boolean
    /**
     * JSON schema identifier
     */
    schema?: string
}

interface ChatTaskOptions {
    command: string
    cwd?: string
    env?: Record<string, string>
    args?: string[]
}

type JSONSchemaTypeName =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "null"

type JSONSchemaType =
    | string //
    | number
    | boolean
    | JSONSchemaObject
    | JSONSchemaArray
    | null

interface JSONSchemaObject {
    type: "object"
    description?: string
    properties?: {
        [key: string]: {
            description?: string
            type?: JSONSchemaType
        }
    }
    required?: string[]
    additionalProperties?: boolean
}

interface JSONSchemaArray {
    type: "array"
    description?: string
    items?: JSONSchemaType
}

type JSONSchema = JSONSchemaObject | JSONSchemaArray

// keep in sync with prompt_type.d.ts
interface PromptContext {
    writeText(body: string): void
    $(strings: TemplateStringsArray, ...args: any[]): void
    gptool(options: PromptArgs): void
    system(options: PromptArgs): void
    fence(body: StringLike, options?: DefOptions): void
    def(name: string, body: StringLike, options?: DefOptions): void
    defFiles(files: LinkedFile[]): void
    defFunction(
        name: string,
        description: string,
        parameters: ChatFunctionParameters,
        fn: (
            args: { context: ChatFunctionCallContext } & Record<string, any>
        ) => ChatFunctionCallOutput | Promise<ChatFunctionCallOutput>
    ): void
    defSchema(name: string, schema: JSONSchema): void
    fetchText(urlOrFile: string | LinkedFile): Promise<{
        ok: boolean
        status: number
        text?: string
        file?: LinkedFile
    }>
    env: ExpansionVariables
}



// keep in sync with PromptContext!

/**
 * Setup prompt title and other parameters.
 * Exactly one call should be present on top of .gptool.js file.
 */
declare function gptool(options: PromptArgs): void

/**
 * Equivalent of gptool() for system prompts.
 */
declare function system(options: PromptArgs): void

/**
 * Append given string to the prompt. It automatically appends "\n".
 * Typically best to use `` $`...` ``-templates instead.
 */
declare function writeText(body: string): void

/**
 * Append given string to the prompt. It automatically appends "\n".
 * `` $`foo` `` is the same as `text("foo")`.
 */
declare function $(strings: TemplateStringsArray, ...args: any[]): string

/**
 * Appends given (often multi-line) string to the prompt, surrounded in fences.
 * Similar to `text(env.fence); text(body); text(env.fence)`
 *
 * @param body string to be fenced
 */
declare function fence(body: StringLike, options?: DefOptions): void

/**
 * Defines `name` to be the (often multi-line) string `body`.
 * Similar to `text(name + ":"); fence(body, language)`
 *
 * @param name name of defined entity, eg. "NOTE" or "This is text before NOTE"
 * @param body string to be fenced/defined
 */
declare function def(name: string, body: StringLike, options?: DefOptions): void

/**
 * Inline supplied files in the prompt.
 * Similar to `for (const f in files) { def("File " + f.filename, f.contents) }`
 *
 * @param files files to define, eg. `env.files` or a subset thereof
 */
declare function defFiles(files: LinkedFile[]): void

/**
 * Declares a function that can be called from the prompt.
 * @param name The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
 * @param description A description of what the function does, used by the model to choose when and how to call the function.
 * @param parameters The parameters the functions accepts, described as a JSON Schema object.
 * @param fn callback invoked when the LLM requests to run this function
 */
declare function defFunction(
    name: string,
    description: string,
    parameters: ChatFunctionParameters,
    fn: (
        args: { context: ChatFunctionCallContext } & Record<string, any>
    ) => ChatFunctionCallOutput | Promise<ChatFunctionCallOutput>
): void

/**
 * Variables coming from the fragment on which the prompt is operating.
 */
declare var env: ExpansionVariables

/**
 * Fetches a given URL and returns the response.
 * @param url
 */
declare function fetchText(
    url: string | LinkedFile
): Promise<{ ok: boolean; status: number; text?: string; file?: LinkedFile }>

/**
 * Declares a JSON schema variable.
 * @param name name of the variable
 * @param schema JSON schema instance
 */
declare function defSchema(name: string, schema: JSONSchema)
