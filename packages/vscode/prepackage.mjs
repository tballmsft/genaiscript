import 'zx/globals'

// workaround yarn workspaces
await fs.copy('../../node_modules/pdfjs-dist/package.json', './node_modules/pdfjs-dist/package.json', { overwrite: true })
await $`cp -R ../../node_modules/pdfjs-dist/build ./node_modules/pdfjs-dist`
await $`cp -R ../../node_modules/tree-sitter-wasms ./node_modules`

const pkg = await fs.readJSON('./package.json')
pkg._enabledApiProposals = pkg.enabledApiProposals
pkg.displayName = "GenAIScript"
delete pkg.enabledApiProposals
await fs.writeJSON('./package.json', pkg, { spaces: 4 })
console.log(`cleaned package.json`)