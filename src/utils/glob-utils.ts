import { minimatch } from 'minimatch'
import { Vault } from 'obsidian'

export const findFilesMatchingPatterns = (
  patterns: string[],
  vault: Vault,
) => {
  const files = vault.getMarkdownFiles()
  return files.filter((file) => {
    return patterns.some((pattern) => minimatch(file.path, pattern))
  })
}