import { App, Notice } from 'obsidian'

import { useSettings } from '../../../contexts/settings-context'
import NeuralComposerPlugin from '../../../main'
import { NeuralComposerSettingsSchema } from '../../../settings/schema/setting.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ConfirmModal } from '../../modals/ConfirmModal'

type EtcSectionProps = {
  app: App
  plugin: NeuralComposerPlugin
}

export function EtcSection({ app }: EtcSectionProps) {
  const { setSettings } = useSettings()

  const handleResetSettings = () => {
    new ConfirmModal(app, {
      title: 'Reset settings',
      message:
        'Are you sure you want to reset all settings to default values? This cannot be undone.',
      ctaText: 'Reset',
      // Fix: Wrap async function to satisfy void return type
      onConfirm: () => {
        void (async () => {
            const defaultSettings = NeuralComposerSettingsSchema.parse({})
            await setSettings(defaultSettings)
            new Notice('Settings have been reset to defaults')
        })()
      },
    }).open()
  }

  return (
    <div className="nrlcmp-settings-section">
      <div className="nrlcmp-settings-header">Etc</div>

      <ObsidianSetting
        name="Reset settings"
        desc="Reset all settings to default values"
      >
        <ObsidianButton text="Reset" warning onClick={handleResetSettings} />
      </ObsidianSetting>
    </div>
  )
}