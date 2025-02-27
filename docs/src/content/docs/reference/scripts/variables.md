---
title: Variables
description: Discover how to utilize and customize script variables for dynamic scripting capabilities with env.vars.
keywords: script variables, environment variables, CLI overrides, dynamic scripting, configuration
sidebar:
    order: 3.5
---

The `env.vars` object contains a set of variable values. You can use these variables to parameterize your script.

```javascript
// grab locale from variable or default to en-US
const locale = env.vars.locale || "en-US"
```

### Variables from the CLI

Use the `vars` field in the CLI to override variables. vars takes a sequence of `key=value` pairs.

```sh
genaiscript run ... --vars myvar=myvalue myvar2=myvalue2 ...
```

## Spec Variables

If you manually author a [spec](/genaiscript/reference/scripts/specs/), you can configure variables as well.

```markdown
Lorem ipsum...

<!-- @locale latin -->
```
