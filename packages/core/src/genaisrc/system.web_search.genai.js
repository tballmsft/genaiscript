system({
    title: "Web Search",
    description: "Function to do a web search.",
    group: "Functions",
})

defFunction(
    "web_search",
    "Search the web for a user query using Bing Search.",
    {
        type: "object",
        properties: {
            q: {
                type: "string",
                description: "Search query.",
            },
        },
        required: ["q"],
    },
    async (args) => {
        const { q } = args
        const { webPages } = await retreival.webSearch(q)
        return YAML.stringify(
            webPages.map((f) => ({
                url: f.filename,
                name: f.label,
                snippet: f.content,
            }))
        )
    }
)
