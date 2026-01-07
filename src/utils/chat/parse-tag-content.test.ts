import { ParsedTagContent, parseTagContents } from './parse-tag-content'

describe('parsenrlcmpBlocks', () => {
  it('should parse a string with nrlcmp_block elements', () => {
    const input = `Some text before
<nrlcmp_block language="markdown" filename="example.md">
# Example Markdown

This is a sample markdown content for testing purposes.

## Features

- Lists
- **Bold text**
- *Italic text*
- [Links](https://example.com)

### Code Block
\`\`\`python
print("Hello, world!")
\`\`\`
</nrlcmp_block>
Some text after`

    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Some text before' },
      {
        type: 'nrlcmp_block',
        content: `# Example Markdown

This is a sample markdown content for testing purposes.

## Features

- Lists
- **Bold text**
- *Italic text*
- [Links](https://example.com)

### Code Block
\`\`\`python
print("Hello, world!")
\`\`\``,
        language: 'markdown',
        filename: 'example.md',
      },
      { type: 'string', content: 'Some text after' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle empty nrlcmp_block elements', () => {
    const input = `
      <nrlcmp_block language="python"></nrlcmp_block>
    `

    const expected: ParsedTagContent[] = [
      { type: 'string', content: '      ' },
      {
        type: 'nrlcmp_block',
        content: '',
        language: 'python',
        filename: undefined,
      },
      { type: 'string', content: '    ' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle input without nrlcmp_block elements', () => {
    const input = 'Just a regular string without any nrlcmp_block elements.'

    const expected: ParsedTagContent[] = [{ type: 'string', content: input }]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle multiple nrlcmp_block elements', () => {
    const input = `Start
<nrlcmp_block language="python" filename="script.py">
def greet(name):
    print(f"Hello, {name}!")
</nrlcmp_block>
Middle
<nrlcmp_block language="markdown" filename="example.md">
# Using tildes for code blocks

Did you know that you can use tildes for code blocks?

~~~python
print("Hello, world!")
~~~
</nrlcmp_block>
End`

    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      {
        type: 'nrlcmp_block',
        content: `def greet(name):
    print(f"Hello, {name}!")`,
        language: 'python',
        filename: 'script.py',
      },
      { type: 'string', content: 'Middle' },
      {
        type: 'nrlcmp_block',
        content: `# Using tildes for code blocks

Did you know that you can use tildes for code blocks?

~~~python
print("Hello, world!")
~~~`,
        language: 'markdown',
        filename: 'example.md',
      },
      { type: 'string', content: 'End' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle unfinished nrlcmp_block with only opening tag', () => {
    const input = `Start
<nrlcmp_block language="markdown">
# Unfinished nrlcmp_block

Some text after without closing tag`
    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      {
        type: 'nrlcmp_block',
        content: `# Unfinished nrlcmp_block

Some text after without closing tag`,
        language: 'markdown',
        filename: undefined,
      },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle nrlcmp_block with startline and endline attributes', () => {
    const input = `<nrlcmp_block language="markdown" startline="2" endline="5"></nrlcmp_block>`
    const expected: ParsedTagContent[] = [
      {
        type: 'nrlcmp_block',
        content: '',
        language: 'markdown',
        startLine: 2,
        endLine: 5,
      },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })
})

describe('parseThink', () => {
  it('should parse a string with think elements', () => {
    const input = `Start
<think>Thinking...</think>
End`
    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      { type: 'think', content: 'Thinking...' },
      { type: 'string', content: 'End' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle unfinished think with only opening tag', () => {
    const input = `Start
<think>Thinking...
Some text after without closing tag`
    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      {
        type: 'think',
        content: 'Thinking...\nSome text after without closing tag',
      },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle multiple think elements', () => {
    const input = `Start
<think>First thought</think>
Some text after
<think>Second thought</think>
End`
    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      { type: 'think', content: 'First thought' },
      { type: 'string', content: 'Some text after' },
      { type: 'think', content: 'Second thought' },
      { type: 'string', content: 'End' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })
})

describe('parsenrlcmpBlockAndThink', () => {
  it('should parse a string with nrlcmp_block and think elements', () => {
    const input = `Start
<think>Thinking...</think>

<nrlcmp_block language="markdown" filename="example.md">
# Example Markdown

This is a sample markdown content for testing purposes.

## Features

- Lists
- **Bold text**
- *Italic text*
- [Links](https://example.com)
</nrlcmp_block>
End`

    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      { type: 'think', content: 'Thinking...' },
      { type: 'string', content: '' },
      {
        type: 'nrlcmp_block',
        content: `# Example Markdown

This is a sample markdown content for testing purposes.

## Features

- Lists
- **Bold text**
- *Italic text*
- [Links](https://example.com)`,
        language: 'markdown',
        filename: 'example.md',
        startLine: undefined,
        endLine: undefined,
      },
      { type: 'string', content: 'End' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })

  it('should handle nested nrlcmp_block and think elements', () => {
    const input = `Start
<think>Thinking...
<nrlcmp_block language="markdown" filename="example.md">
# Example Markdown

This is a sample markdown content for testing purposes.

## Features
</nrlcmp_block>
</think>
End`
    const expected: ParsedTagContent[] = [
      { type: 'string', content: 'Start' },
      {
        type: 'think',
        content: `Thinking...
<nrlcmp_block language="markdown" filename="example.md">
# Example Markdown

This is a sample markdown content for testing purposes.

## Features
</nrlcmp_block>`,
      },
      { type: 'string', content: 'End' },
    ]

    const result = parseTagContents(input)
    expect(result).toEqual(expected)
  })
})
