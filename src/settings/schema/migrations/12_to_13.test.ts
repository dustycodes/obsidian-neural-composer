import { migrateFrom12To13 } from './12_to_13'

describe('Migration from v12 to v13', () => {
  it('should increment version to 13', () => {
    const result = migrateFrom12To13({ version: 12 })
    expect(result.version).toBe(13)
  })

  it('should add lightRagServerUrl with default value when missing', () => {
    const result = migrateFrom12To13({ version: 12 })
    expect(result.lightRagServerUrl).toBe('http://localhost:9621')
  })

  it('should preserve an existing lightRagServerUrl', () => {
    const result = migrateFrom12To13({
      version: 12,
      lightRagServerUrl: 'https://my-server.example.com:9621',
    })
    expect(result.lightRagServerUrl).toBe('https://my-server.example.com:9621')
  })

  it('should add lightRagUseRemote with default false when missing', () => {
    const result = migrateFrom12To13({ version: 12 })
    expect(result.lightRagUseRemote).toBe(false)
  })

  it('should add lightRagApiKey with empty string when missing', () => {
    const result = migrateFrom12To13({ version: 12 })
    expect(result.lightRagApiKey).toBe('')
  })

  it('should preserve an existing lightRagApiKey', () => {
    const result = migrateFrom12To13({
      version: 12,
      lightRagApiKey: 'my-secret-key',
    })
    expect(result.lightRagApiKey).toBe('my-secret-key')
  })

  it('should preserve other existing settings unchanged', () => {
    const oldSettings = {
      version: 12,
      lightRagCommand: 'lightrag-server',
      lightRagWorkDir: '/custom/path',
    }
    const result = migrateFrom12To13(oldSettings)
    expect(result.lightRagCommand).toBe('lightrag-server')
    expect(result.lightRagWorkDir).toBe('/custom/path')
  })
})
