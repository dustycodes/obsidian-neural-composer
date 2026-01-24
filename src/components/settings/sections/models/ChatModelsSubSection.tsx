import { Settings, Trash2 } from 'lucide-react'
import { App, Notice } from 'obsidian'
import { ObsidianToggle } from 'src/components/common/ObsidianToggle'

import { DEFAULT_CHAT_MODELS } from '../../../../constants'
import { useSettings } from '../../../../contexts/settings-context'
import NeuralComposerPlugin from '../../../../main'
import { ConfirmModal } from '../../../modals/ConfirmModal'
import { AddChatModelModal } from '../../modals/AddChatModelModal'

import {
  ChatModelSettingsModal,
  hasChatModelSettings,
} from './ChatModelSettings'

type ChatModelsSubSectionProps = {
  app: App
  plugin: NeuralComposerPlugin
}

const isEnabled = (enable: boolean | undefined | null) => enable ?? true

export function ChatModelsSubSection({
  app,
  plugin,
}: ChatModelsSubSectionProps) {
  const { settings, setSettings } = useSettings()

  // Removed async keyword as opening modal is synchronous
  const handleDeleteChatModel = (modelId: string) => {
    if (modelId === settings.chatModelId || modelId === settings.applyModelId) {
      // Fix: Sentence case ("Chat model" -> "chat model")
      new Notice(
        'Cannot remove model that is currently selected as chat model or apply model',
      )
      return
    }

    const message = `Are you sure you want to delete model "${modelId}"?`
    new ConfirmModal(app, {
      title: 'Delete chat model',
      message: message,
      ctaText: 'Delete',
      onConfirm: () => {
        // Wrap async logic
        void (async () => {
            await setSettings({
              ...settings,
              chatModels: [...settings.chatModels].filter((v) => v.id !== modelId),
            })
        })()
      },
    }).open()
  }

  const handleToggleEnableChatModel = async (
    modelId: string,
    value: boolean,
  ) => {
    if (
      !value &&
      (modelId === settings.chatModelId || modelId === settings.applyModelId)
    ) {
      // Fix: Sentence case ("Chat model" -> "chat model")
      new Notice(
        'Cannot disable model that is currently selected as chat model or apply model',
      )

      // to trigger re-render
      await setSettings({
        ...settings,
        chatModels: [...settings.chatModels].map((v) =>
          v.id === modelId ? { ...v, enable: true } : v,
        ),
      })
      return
    }

    await setSettings({
      ...settings,
      chatModels: [...settings.chatModels].map((v) =>
        v.id === modelId ? { ...v, enable: value } : v,
      ),
    })
  }

  return (
    <div>
      <div className="nrlcmp-settings-sub-header">Chat models</div>
      <div className="nrlcmp-settings-desc">Models used for chat and apply</div>

      <div className="nrlcmp-settings-table-container">
        <table className="nrlcmp-settings-table">
          <colgroup>
            <col />
            <col />
            <col />
            <col className="nrlcmp-col-enable" />
            <col className="nrlcmp-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Provider ID</th>
              <th>Model</th>
              <th>Enable</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {settings.chatModels.map((chatModel) => (
              <tr key={chatModel.id}>
                <td>{chatModel.id}</td>
                <td>{chatModel.providerId}</td>
                <td>{chatModel.model}</td>
                <td>
                  <ObsidianToggle
                    value={isEnabled(chatModel.enable)}
                    onChange={(value) =>
                      void handleToggleEnableChatModel(chatModel.id, value)
                    }
                  />
                </td>
                <td>
                  <div className="nrlcmp-settings-actions">
                    {hasChatModelSettings(chatModel) && (
                      <button
                        onClick={() => {
                          new ChatModelSettingsModal(
                            chatModel,
                            app,
                            plugin,
                          ).open()
                        }}
                        className="clickable-icon"
                        aria-label="Settings"
                      >
                        <Settings size={16} />
                      </button>
                    )}
                    {!DEFAULT_CHAT_MODELS.some(
                      (v) => v.id === chatModel.id,
                    ) && (
                      <button
                        onClick={() => handleDeleteChatModel(chatModel.id)}
                        className="clickable-icon"
                        aria-label="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                <button
                  onClick={() => {
                    new AddChatModelModal(app, plugin).open()
                  }}
                >
                  Add custom model
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}