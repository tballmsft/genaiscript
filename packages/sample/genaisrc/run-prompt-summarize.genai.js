script({
    title: "run prompt summarize",
})

for (const file of env.files) {
    const { text } = await runPrompt(
        (_) => {
            _.def("FILE", file)
            _.$`Summarize the FILE. Be concise.`
        },
        {
            model: "gpt-3.5-turbo",
        }
    )

    def("FILE", { ...file, content: text })
}

$`Summarized all files in one paragraph.`
