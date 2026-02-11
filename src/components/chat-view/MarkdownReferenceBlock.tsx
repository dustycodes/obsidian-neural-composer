import clsx from 'clsx'
import { Eye } from 'lucide-react'
import { PropsWithChildren, useEffect, useMemo, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useDarkModeContext } from '../../contexts/dark-mode-context'
import { openMarkdownFile, readTFileContent } from '../../utils/obsidian'

import { ObsidianMarkdown } from './ObsidianMarkdown'
import { MemoizedSyntaxHighlighterWrapper } from './SyntaxHighlighterWrapper'

export default function MarkdownReferenceBlock({
  filename,
  startLine,
  endLine,
  language,
}: PropsWithChildren<{
  filename: string
  startLine: number
  endLine: number
  language?: string
}>) {
  const app = useApp()
  const { isDarkMode } = useDarkModeContext()

  const [isPreviewMode, setIsPreviewMode] = useState(true)
  const [blockContent, setBlockContent] = useState<string | null>(null)

  const wrapLines = useMemo(() => {
    return !language || ['markdown'].includes(language)
  }, [language])

  useEffect(() => {
    async function fetchBlockContent() {
      const file = app.vault.getFileByPath(filename)
      if (!file) {
        setBlockContent(null)
        return
      }
      const fileContent = await readTFileContent(file, app.vault)
      const content = fileContent
        .split('\n')
        .slice(startLine - 1, endLine)
        .join('\n')
      setBlockContent(content)
    }

    // FIX: Use void operator to explicitly ignore the floating promise
    void fetchBlockContent()
  }, [filename, startLine, endLine, app.vault])

  const handleOpenFile = () => {
    // FIX: Ensure this promise is also marked as ignored if openMarkdownFile is async
    void openMarkdownFile(app, filename, startLine)
  }

  return (
    blockContent && (
      <div className={clsx('nrlcmp-code-block', filename && 'has-filename')}>
        <div className="nrlcmp-code-block-header">
          {filename && (
            <div
              className="nrlcmp-code-block-header-filename"
              onClick={handleOpenFile}
            >
              {filename}
            </div>
          )}
          <div className="nrlcmp-code-block-header-button-container">
            <button
              className="clickable-icon nrlcmp-code-block-header-button"
              onClick={() => {
                setIsPreviewMode(!isPreviewMode)
              }}
            >
              <Eye size={12} />
              {isPreviewMode ? 'View Raw Text' : 'View Formatted'}
            </button>
          </div>
        </div>
        {isPreviewMode ? (
          <div className="nrlcmp-code-block-obsidian-markdown">
            <ObsidianMarkdown content={blockContent} scale="sm" />
          </div>
        ) : (
          <MemoizedSyntaxHighlighterWrapper
            isDarkMode={isDarkMode}
            language={language}
            hasFilename={!!filename}
            wrapLines={wrapLines}
          >
            {blockContent}
          </MemoizedSyntaxHighlighterWrapper>
        )}
      </div>
    )
  )
}