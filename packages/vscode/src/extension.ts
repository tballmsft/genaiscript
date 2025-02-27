import * as vscode from "vscode"
import { ExtensionContext } from "vscode"
import { ExtensionState } from "./state"
import { activateStatusBar } from "./statusbar"
import "isomorphic-fetch"
import { EXTENSION_ID, TOOL_NAME, logError } from "genaiscript-core"
import { activateFragmentCommands } from "./fragmentcommands"
import { activateMarkdownTextDocumentContentProvider } from "./markdowndocumentprovider"
import { activatePrompTreeDataProvider } from "./prompttree"
import { activatePromptCommands, commandButtons } from "./promptcommands"
import { activateOpenAIRequestTreeDataProvider } from "./openairequesttree"
import { activateAIRequestTreeDataProvider } from "./airequesttree"
//import { activateChatParticipant } from "./chat/participant"
import { activateRetreivalCommands } from "./retreivalcommands"
// import { activateTokensStatusBar } from "./tokenstatusbar"

export async function activate(context: ExtensionContext) {
    if (typeof WebSocket === "undefined") {
        try {
            require("websocket-polyfill")
        } catch (err) {
            console.error("websocket polyfill failed")
            console.error(err)
        }
    }

    const state = new ExtensionState(context)
    activatePromptCommands(state)
    activateFragmentCommands(state)
    activateRetreivalCommands(state)
    activateMarkdownTextDocumentContentProvider(state)
    activatePrompTreeDataProvider(state)
    activateAIRequestTreeDataProvider(state)
    activateOpenAIRequestTreeDataProvider(state)
    activateStatusBar(state)
    // activateTokensStatusBar(state)
    // activateChatParticipant(state)

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "genaiscript.request.abort",
            async () => {
                await state.cancelAiRequest()
                await vscode.window.showInformationMessage(
                    `${TOOL_NAME} - request aborted.`
                )
            }
        ),
        vscode.commands.registerCommand("genaiscript.request.retry", () =>
            state.retryAIRequest()
        ),
        vscode.commands.registerCommand(
            "genaiscript.request.status",
            async () => {
                const cmds = commandButtons(state)
                if (!cmds.length)
                    await vscode.window.showInformationMessage(
                        `${TOOL_NAME} - no request.`
                    )
                else {
                    const res = await vscode.window.showQuickPick(cmds, {
                        canPickMany: false,
                    })
                    if (res) vscode.commands.executeCommand(res.cmd)
                }
            }
        ),
        vscode.commands.registerCommand(
            "genaiscript.openIssueReporter",
            async () => {
                const issueBody: string[] = [
                    `## Describe the issue`,
                    `A clear and concise description of what the bug is.`,
                    ``,
                    `## To Reproduce`,
                    `Steps to reproduce the behavior`,
                    ``,
                    `## Expected behavior`,
                    `A clear and concise description of what you expected to happen.`,
                    ``,
                    `## Environment`,
                    ``,
                ]
                issueBody.push(`vscode: ${vscode.version}`)
                issueBody.push(
                    `extension: ${
                        context.extension?.packageJSON?.version || "?"
                    }`
                )
                if (state.aiRequest?.response) {
                    issueBody.push(`## Request`)
                    issueBody.push("`````")
                    issueBody.push(state.aiRequest.response.trace)
                    issueBody.push("`````")
                }
                await vscode.commands.executeCommand(
                    "workbench.action.openIssueReporter",
                    {
                        extensionId: EXTENSION_ID,
                        issueBody: issueBody.join("\n"),
                    }
                )
            }
        )
    )

    await state.activate()
}
