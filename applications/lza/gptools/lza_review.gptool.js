gptool({
    title: "LZA review",
    description: "Analyze the contents of SPEC files from a git repository of a Microsoft Azure Landing Zone Accelerator (LZA) for an enterprise software company. The user will share a file and its dependencies for you to analyze.",
    categories: ["Azure Landing Zone"],
    system: ["system", "system.explanations", "system.technical", "system.annotations"],
    model: "gpt-4"
})

// use $ to output formatted text to the prompt
$`# Context

You are a Azure Bicep language expert.
You will analyze the contents of SPEC files 
from a git repository of a Microsoft Azure Landing Zone Accelerator (LZA) 
for an enterprise software company.

## Definitions
### Action
Something being done by the SPEC file or its dependencies when used. Understanding the Action requires understanding the purpose of the script and its dependencies which requires deeper analysis than just describing the basic implementation of the name or steps in the script. The Action is the *why* of the script, not the *how*.

### Target
Specific Azure service or cloud component that will be impacted by the Action. Example Targets include Application Insights, Application Gateway, Virtual Machines, and GitHub but could even include other clouds or custom components.

### Deployed
Any cloud resource that is deployed after this file is used that was not present before this file was used. Cloud resources that were already deployed before this file was used are not considered Deployed, and any cloud resources that are *always* deleted after this file is used are not considered Deployed.

## Guidance on Actions
It is important to explain *why* the Action is being taken and *what* is being done in your description of the Action. Describing the purpose of the Action requires that you understand the value of the performed step. When you write the description of the Action, you should explain *why* and *what* is being done rather than just describing the implementation. For example, a script that clones a git repo doesn't exist to clone a git repo. It exists to download the source code that does something. Your description of the Action should explain what the script is doing with the source code that it downloads with as much detail as you can infer from the provided file contents.


## Task 1

Identify security issues in SPEC files. 
Use ANNOTATIONS to highlight the issues, best practices or improvements in SPECS. 

-  Look for bad practices.
-  Look for weak secrets and passwords
-  Look for any pattern that would to a security issue.
-  Add link to documentation about security issues.
-  Do NOT generate annotations for DEPS files.
-  Do NOT generate a bullet point list.
-  Do NOT report notice annotations, only error and warning.

## Task 2

1. Review the Azure file and its dependencies that the user uploads
2. Perform a very careful analysis of all the file contents that you receive to really understand what is happening
3. Develop a lengthy list of actions that are being performed by the file and its dependencies. Make sure that you understand what is being done and why it is being done in creating this list using the approach from "Guidance on Actions" above.
4. Double check your list of actions to make sure that you have a complete list of actions and add any that you missed
5. Organize the actions by the target services or cloud components that are impacted by the actions
6. Identify any cloud resources that are deployed after this file is used that were not present before this file was used and add them to the "Deployed" list. If nothing that you find directly within the provided file content meets this criteria, please leave the list empty.
7. Generate a YAML file with the results formatted as follow:
`

fence(`targets:
  target:
    name: <target name>
    source: <path to the file>
    action: <description of the action>
deployments:
  deployment:
    name: <deployment name>
    source: <path to the file>
`, { language: "yaml" })

const biceps = env.links.filter(f => f.filename.endsWith(".bicep"))
def("SPECS", biceps, { lineNumbers: true })

// inline dependencies
for (const link of biceps) {
    const filename = link.filename
    const dirname = filename.split(/\//g).slice(0, -1).join("/") + "/"
    const content = link.content
    const dependencies = content.matchAll(/module\s+([^\s]+)\s+\'([^']+)'/g)
    for (const dependency of dependencies) {
        const [, , path] = dependency
        if (path.includes("shared")) continue // ignore those shared files
        const dp = dirname + path
        const resp = await fetchText(dp)
        def("DEPS", resp.file, { lineNumbers: true })
    }
}
