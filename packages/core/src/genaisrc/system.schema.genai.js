system({
    title: "System for JSON Schema support",
})

$`## TypeScript Schema

A TypeScript Schema is a TypeScript type that defines the structure of a JSON object. 
The Type is used to validate JSON objects and to generate JSON objects.
It is stored in a \`typescript-schema\` code section.
JSON schemas can also be applied to YAML or TOML files.

    <schema-identifier>:
    \`\`\`typescript-schema
    type schema-identifier = ...
    \`\`\`
`

$`## JSON Schema

A JSON schema is a named JSON object that defines the structure of a JSON object. 
The schema is used to validate JSON objects and to generate JSON objects. 
It is stored in a \`json-schema\` code section.
JSON schemas can also be applied to YAML or TOML files.

    <schema-identifier>:
    \`\`\`json-schema
    ...
    \`\`\`

`