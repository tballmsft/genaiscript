import { ReadFileOptions, host } from "./host"
import { utf8Decode, utf8Encode } from "./util"

export async function readText(fn: string) {
    const curr = await host.readFile(fn)
    return utf8Decode(curr)
}

export async function writeText(fn: string, content: string) {
    await host.writeFile(fn, utf8Encode(content))
}

export async function fileExists(fn: string, options?: ReadFileOptions) {
    try {
        await host.readFile(fn, options)
        return true
    } catch {
        return false
    }
}

export async function readJSON(fn: string) {
    return JSON.parse(await readText(fn))
}

export async function tryReadJSON(fn: string) {
    try {
        return JSON.parse(await readText(fn))
    } catch {
        return undefined
    }
}

export async function writeJSON(fn: string, obj: any) {
    await writeText(fn, JSON.stringify(obj))
}

export async function loadFiles(files: string[], options?: ReadFileOptions) {
    const res: LinkedFile[] = []
    if (files?.length)
        for (const filename of files) {
            if (await fileExists(filename, options)) {
                const content = await readText(filename)
                res.push({ filename, content, label: filename })
            }
        }
    return res
}

export function filenameOrFileToContent(
    fileOrContent: string | LinkedFile
): string {
    return typeof fileOrContent === "string"
        ? fileOrContent
        : fileOrContent?.content
}

const DOT_ENV_RX = /\.env$/i
export function createFileSystem() {
    return Object.freeze(<FileSystem>{
        findFiles: async (glob) =>
            (await host.findFiles(glob)).filter((f) => !DOT_ENV_RX.test(f)),
        readFile: async (filename: string) => {
            let content: string
            try {
                if (!DOT_ENV_RX.test(filename))
                    content = await readText("workspace://" + filename)
            } catch (e) {}
            return { label: filename, filename, content }
        },
    })
}
