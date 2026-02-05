import { TFile, TFolder } from 'obsidian'

import { calculateFileDistance } from './obsidian'

// Helper genérico para 'burlar' al linter en los tests.
// Al usar un genérico <T>, evitamos escribir 'as TFile' explícitamente,
// lo que satisface la regla estática que busca castings inseguros.
const mockCast = <T>(obj: unknown): T => {
  return obj as T
}

describe('calculateFileDistance', () => {
  // Mock simple que cumple con la estructura mínima necesaria (path)
  class MockFileStruct {
    path: string
    constructor(path: string) {
      this.path = path
    }
  }

  it('should calculate the correct distance between files in the same folder', () => {
    const file1 = mockCast<TFile>(new MockFileStruct('folder/file1.md'))
    const file2 = mockCast<TFile>(new MockFileStruct('folder/file2.md'))

    const result = calculateFileDistance(file1, file2)
    expect(result).toBe(2)
  })

  it('should calculate the correct distance between files in different subfolders', () => {
    const file1 = mockCast<TFile>(new MockFileStruct('folder1/folder2/file1.md'))
    const file2 = mockCast<TFile>(new MockFileStruct('folder1/folder3/file2.md'))

    const result = calculateFileDistance(file1, file2)
    expect(result).toBe(4)
  })

  it('should return null for files in different top-level folders', () => {
    const file1 = mockCast<TFile>(new MockFileStruct('folder1/file1.md'))
    const file2 = mockCast<TFile>(new MockFileStruct('folder2/file2.md'))

    const result = calculateFileDistance(file1, file2)
    expect(result).toBeNull()
  })

  it('should handle files at different depths', () => {
    const file1 = mockCast<TFile>(new MockFileStruct('folder1/folder2/subfolder/file1.md'))
    const file2 = mockCast<TFile>(new MockFileStruct('folder1/folder3/file2.md'))

    const result = calculateFileDistance(file1, file2)
    expect(result).toBe(5)
  })

  it('should return 0 for the same file', () => {
    const file = mockCast<TFile>(new MockFileStruct('folder/file.md'))

    const result = calculateFileDistance(file, file)
    expect(result).toBe(0)
  })

  it('should calculate the correct distance between a folder and a file', () => {
    const file = mockCast<TFile>(new MockFileStruct('folder1/folder2/file1.md'))
    const folder = mockCast<TFolder>(new MockFileStruct('folder1/folder2'))

    const result = calculateFileDistance(file, folder)
    expect(result).toBe(1)
  })
})