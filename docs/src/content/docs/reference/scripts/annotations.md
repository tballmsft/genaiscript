---
title: Annotations
description: Learn how to add annotations such as errors, warnings, or notes to LLM output for integration with VSCode or CI environments.
keywords: annotations, LLM output, VSCode integration, CI environment, GitHub Actions
sidebar:
    order: 11
---

Annotations are errors, warning or notes that can be added to the LLM output. They are extracted and injected in VSCode or your CI environment.

```js "annotations"
$`Report issues with this code using annotations.`
```

## Configuration

If you use `annotation` in your script text and you do not specify the `system` field, `system.annotations` will be added by default.

Using the `system.annotations` system prompt, you can have the LLM generate errors, warnings and notes.

```js "\"system.annotations\""
script({
    ...
    system: [..., "system.annotations"]
})
```

## Line numbers

The "system.annotations" prompt automatically enables line number injection for all `def` section. This helps 
with the precision of the LLM answer and reduces hallucinations.

## GitHub Action Commands

By default, the annotations use the [GitHub Action Commands](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message) syntax.
This means that the annotations will automatically be extracted by GitHub if you run your script in a GitHub Action.

## Visual Studio Code Programs

The annotation are converted into Visual Studio **Diagnostics** which are presented to the user
through the **Problems** panel. The diagnostics will also appear as squiggly lines in the editor.

## Static Analysis Results Interchange Format (SARIF)

GenAIScript will convert those into SARIF files that can be uploaded to GitHub Actions as security reports, similarly to CodeQL reports.

The [SARIF Viewer](https://marketplace.visualstudio.com/items?itemName=MS-SarifVSCode.sarif-viewer)
extension can be used to visualize the reports.

```yaml title="GitHub Action"
    - name: Run GenAIScript
      run: npx --yes genaiscript ... -oa result.sarif
    - name: Upload SARIF file
        if: success() || failure()
        uses: github/codeql-action/upload-sarif@v3
        with:
            sarif_file: result.sarif
```
